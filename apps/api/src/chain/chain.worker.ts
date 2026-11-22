import { Inject, Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { Worker, type Job } from 'bullmq';
import type IORedis from 'ioredis';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { QUEUE_NAMES, Queues } from '../queue/queue.module';
import { ChainClient } from './chain.client';
import { MintService } from './mint.service';

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
  ) {}

  onModuleInit() {
    if (this.env.RUN_WORKERS !== 'true' || !this.chain.config.enabled) return;
    this.connection = this.queues.connection.duplicate({ maxRetriesPerRequest: null });
    this.worker = new Worker(QUEUE_NAMES.chain, (job: Job) => this.handle(job), { connection: this.connection, concurrency: 1 });
    this.worker.on('error', (err) => this.log.error(`Worker error: ${err.message}`));
    this.worker.on('failed', (job, err) => {
      if (!job || job.name !== 'mint') return;
      const final = job.attemptsMade >= (job.opts.attempts ?? 1);
      const reason = this.chain.errorText(err);
      this.log.warn(`Mint for ticket ${job.data.ticketId} failed (attempt ${job.attemptsMade}${final ? ', will retry in the sweep' : ''}): ${reason}`);
      if (final) void this.mints.markFailed(job.data.ticketId, reason).catch(() => undefined);
    });
    void this.queues.chain
      .upsertJobScheduler('chain-sweep', { every: 60_000 }, { name: 'sweep', opts: { removeOnComplete: 10, removeOnFail: 50 } })
      .catch((err: Error) => this.log.error(`Could not schedule the chain sweep: ${err.message}`));
  }

  async handle(job: Job): Promise<unknown> {
    if (job.name === 'sweep') return this.sweep();
    return this.mints.processMint(job.data.ticketId as string);
  }

  async sweep(): Promise<number> {
    if (this.chain.configProblem()) return 0;
    const ids = await this.mints.ticketsToSweep();
    for (const id of ids) await this.queues.enqueueMint(id);
    if (ids.length) this.log.log(`Sweep: ${ids.length} tickets re-queued for minting`);
    return ids.length;
  }

  async onApplicationShutdown() {
    await this.worker?.close();
    this.connection?.disconnect();
  }
}
