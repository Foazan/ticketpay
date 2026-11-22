import { Global, Inject, Injectable, Logger, Module, OnApplicationShutdown } from '@nestjs/common';
import { Queue, type JobsOptions } from 'bullmq';
import IORedis from 'ioredis';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';

export const REDIS = Symbol('REDIS');
export const QUEUE_NAMES = { webhooks: 'merchant-webhooks', maintenance: 'maintenance' } as const;

/** Owns the Redis connection and the queues. Workers live in their own modules. */
@Injectable()
export class Queues implements OnApplicationShutdown {
  private readonly log = new Logger('Queues');
  readonly webhooks: Queue;
  readonly maintenance: Queue;

  constructor(
    @Inject(REDIS) readonly connection: IORedis,
    @Inject(ENV) private readonly env: Env,
  ) {
    this.webhooks = new Queue(QUEUE_NAMES.webhooks, { connection });
    this.maintenance = new Queue(QUEUE_NAMES.maintenance, { connection });
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
    await Promise.allSettled([this.webhooks.close(), this.maintenance.close()]);
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
