import { Global, Inject, Injectable, Logger, Module, OnApplicationShutdown } from '@nestjs/common';
import { Queue, type JobsOptions } from 'bullmq';
import IORedis from 'ioredis';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';

export const REDIS = Symbol('REDIS');
export const QUEUE_NAMES = { webhooks: 'merchant-webhooks', maintenance: 'maintenance', chain: 'chain' } as const;

/** Owns the Redis connection and the queues. Workers live in their own modules. */
@Injectable()
export class Queues implements OnApplicationShutdown {
  private readonly log = new Logger('Queues');
  readonly webhooks: Queue;
  readonly maintenance: Queue;
  readonly chain: Queue;

  constructor(
    @Inject(REDIS) readonly connection: IORedis,
    @Inject(ENV) private readonly env: Env,
  ) {
    this.webhooks = new Queue(QUEUE_NAMES.webhooks, { connection });
    this.maintenance = new Queue(QUEUE_NAMES.maintenance, { connection });
    this.chain = new Queue(QUEUE_NAMES.chain, { connection });
  }

  /** Queues the on-chain redeem for a ticket admitted at the gate. Runs after its mint, on the same queue. */
  async enqueueRedeem(ticketId: string): Promise<void> {
    if (this.env.CHAIN_MODE === 'disabled') return;
    try {
      await this.chain.add(
        'redeem',
        { ticketId },
        {
          jobId: `redeem-${ticketId}`,
          attempts: this.env.MINT_MAX_ATTEMPTS + 2,
          backoff: { type: 'exponential', delay: this.env.MINT_RETRY_BASE_MS },
          removeOnComplete: true,
          removeOnFail: true,
        },
      );
    } catch (err) {
      // The redemption row is committed with chainStatus PENDING; the chain sweep picks it up.
      this.log.error(`Could not enqueue redeem for ticket ${ticketId}: ${(err as Error).message}`);
    }
  }

  /** Queues cancel(tokenId) for a refunded ticket's NFT. Same queue as minting, so it runs after the mint. */
  async enqueueCancel(ticketId: string): Promise<void> {
    if (this.env.CHAIN_MODE === 'disabled') return;
    try {
      await this.chain.add(
        'cancel',
        { ticketId },
        {
          jobId: `cancel-${ticketId}`,
          attempts: this.env.MINT_MAX_ATTEMPTS + 2,
          backoff: { type: 'exponential', delay: this.env.MINT_RETRY_BASE_MS },
          removeOnComplete: true,
          removeOnFail: true,
        },
      );
    } catch (err) {
      this.log.error(`Could not enqueue cancel for ticket ${ticketId}: ${(err as Error).message}`);
    }
  }

  /**
   * Queues the on-chain mint for an issued ticket. Only called for tickets of a backend-verified PAID payment.
   * The job id is derived from the ticket id, so a ticket is never queued twice at the same time.
   */
  async enqueueMint(ticketId: string): Promise<void> {
    if (this.env.CHAIN_MODE === 'disabled') return;
    try {
      await this.chain.add(
        'mint',
        { ticketId },
        {
          jobId: `mint-${ticketId}`,
          attempts: this.env.MINT_MAX_ATTEMPTS,
          backoff: { type: 'exponential', delay: this.env.MINT_RETRY_BASE_MS },
          // Removed when finished, so the sweep can queue the ticket again if it still needs minting.
          removeOnComplete: true,
          removeOnFail: true,
        },
      );
    } catch (err) {
      // The ticket row is committed with mintStatus PENDING; the chain sweep picks it up.
      this.log.error(`Could not enqueue mint for ticket ${ticketId}: ${(err as Error).message}`);
    }
  }

  /** Enqueues a merchant webhook delivery. The job id is the delivery id, so a repeat add is ignored. */
  async enqueueWebhook(deliveryId: string, opts: JobsOptions = {}): Promise<void> {
    try {
      await this.webhooks.add(
        'deliver',
        { deliveryId },
        {
          jobId: deliveryId,
          attempts: this.env.WEBHOOK_MAX_ATTEMPTS,
          backoff: { type: 'exponential', delay: this.env.WEBHOOK_RETRY_BASE_MS },
          removeOnComplete: 1000,
          removeOnFail: 1000,
          ...opts,
        },
      );
    } catch (err) {
      // The delivery row is already committed as PENDING; the maintenance sweep re-enqueues it.
      this.log.error(`Could not enqueue webhook delivery ${deliveryId}: ${(err as Error).message}`);
    }
  }

  async onApplicationShutdown() {
    await Promise.allSettled([this.webhooks.close(), this.maintenance.close(), this.chain.close()]);
    this.connection.disconnect();
  }
}

@Global()
@Module({
  providers: [
    {
      provide: REDIS,
      inject: [ENV],
      // maxRetriesPerRequest: null is required by BullMQ workers.
      useFactory: (env: Env) => new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null, lazyConnect: false }),
    },
    Queues,
  ],
  exports: [Queues, REDIS],
})
export class QueueModule {}
