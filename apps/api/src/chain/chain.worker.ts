import { Inject, Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { Worker, type Job } from 'bullmq';
import type IORedis from 'ioredis';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { QUEUE_NAMES, Queues } from '../queue/queue.module';
import { CancelService, NeedsOperatorError } from './cancel.service';
import { ChainClient } from './chain.client';
import { MintService } from './mint.service';
import { RedeemService } from './redeem.service';

/**
 * Processes the chain queue with concurrency 1, so the signer sends one transaction at a time
 * and nonces never collide. A sweep every minute re-queues tickets whose job was lost or failed.
 */
@Injectable()
export class ChainWorker implements OnModuleInit, OnApplicationShutdown {
  private readonly log = new Logger('ChainWorker');
  private worker: Worker | null = null;
  private connection: IORedis | null = null;

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly queues: Queues,
    private readonly chain: ChainClient,
    private readonly mints: MintService,
    private readonly redeems: RedeemService,
    private readonly cancels: CancelService,
  ) {}

  onModuleInit() {
    if (this.env.RUN_WORKERS !== 'true' || !this.chain.config.enabled) return;
    this.connection = this.queues.connection.duplicate({ maxRetriesPerRequest: null });
    this.worker = new Worker(QUEUE_NAMES.chain, (job: Job) => this.handle(job), { connection: this.connection, concurrency: 1 });
    this.worker.on('error', (err) => this.log.error(`Worker error: ${err.message}`));
    this.worker.on('failed', (job, err) => {
      if (!job || (job.name !== 'mint' && job.name !== 'redeem')) {
        if (job?.name === 'cancel') this.log.warn(`Cancel for ticket ${job.data.ticketId} failed (attempt ${job.attemptsMade}): ${this.chain.errorText(err)}`);
        return;
      }
      const final = job.attemptsMade >= (job.opts.attempts ?? 1);
      const reason = this.chain.errorText(err);
      this.log.warn(`${job.name === 'mint' ? 'Mint' : 'Redeem'} for ticket ${job.data.ticketId} failed (attempt ${job.attemptsMade}${final ? ', will retry in the sweep' : ''}): ${reason}`);
      if (!final) return;
      const mark = job.name === 'mint' ? this.mints.markFailed(job.data.ticketId, reason) : this.redeems.markFailed(job.data.ticketId, reason);
      void mark.catch(() => undefined);
    });
    void this.queues.chain
      .upsertJobScheduler('chain-sweep', { every: 60_000 }, { name: 'sweep', opts: { removeOnComplete: 10, removeOnFail: 50 } })
      .catch((err: Error) => this.log.error(`Could not schedule the chain sweep: ${err.message}`));
  }

  async handle(job: Job): Promise<unknown> {
    if (job.name === 'sweep') return this.sweep();
    if (job.name === 'redeem') return this.redeems.processRedeem(job.data.ticketId as string);
    if (job.name === 'cancel') {
      try {
        return await this.cancels.processCancel(job.data.ticketId as string);
      } catch (err) {
        // Retrying cannot fix a missing role; the failure is recorded for Blockchain monitoring.
        if (err instanceof NeedsOperatorError) return 'needs-operator';
        throw err;
      }
    }
    return this.mints.processMint(job.data.ticketId as string);
  }

  async sweep(): Promise<number> {
    if (this.chain.configProblem()) return 0;
    const ids = await this.mints.ticketsToSweep();
    for (const id of ids) await this.queues.enqueueMint(id);
    const redeemIds = await this.redeems.redemptionsToSweep();
    for (const id of redeemIds) await this.queues.enqueueRedeem(id);
    const cancelIds = await this.cancels.cancelsToSweep();
    for (const id of cancelIds) await this.queues.enqueueCancel(id);
    if (ids.length || redeemIds.length || cancelIds.length) this.log.log(`Sweep: ${ids.length} mints, ${redeemIds.length} redeems and ${cancelIds.length} cancels re-queued`);
    return ids.length + redeemIds.length + cancelIds.length;
  }

  async onApplicationShutdown() {
    await this.worker?.close();
    this.connection?.disconnect();
  }
}
