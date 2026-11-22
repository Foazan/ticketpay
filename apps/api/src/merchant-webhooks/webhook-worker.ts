import { Inject, Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { decryptSecret, merchantWebhookDeliveries, merchants } from '@ticketpay/database';
import { WEBHOOK_HEADERS } from '@ticketpay/shared';
import { Worker, type Job } from 'bullmq';
import type IORedis from 'ioredis';
import { eq, sql } from 'drizzle-orm';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { DB, type Database } from '../db/db.module';
import { GateService } from '../gate/gate.service';
import { PaymentsService } from '../payments/payments.service';
import { QUEUE_NAMES, Queues } from '../queue/queue.module';
import { signWebhook } from './signing';

class RetryableDeliveryError extends Error {}

/**
 * Delivers signed webhooks to merchants. Each attempt is recorded on the delivery row.
 * BullMQ retries with exponential backoff (WEBHOOK_RETRY_BASE_MS, doubling) up to WEBHOOK_MAX_ATTEMPTS.
 * The event id never changes between attempts, so a merchant can deduplicate on it.
 */
@Injectable()
export class WebhookWorker implements OnModuleInit, OnApplicationShutdown {
  private readonly log = new Logger('MerchantWebhooks');
  private workers: Worker[] = [];
  private connections: IORedis[] = [];

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
    private readonly queues: Queues,
    private readonly payments: PaymentsService,
    private readonly gate: GateService,
  ) {}

  onModuleInit() {
    if (this.env.RUN_WORKERS !== 'true') return;
    // BullMQ does not close connections it was given, so they are tracked and closed on shutdown.
    const connection = this.queues.connection.duplicate({ maxRetriesPerRequest: null });
    const maintenanceConnection = this.queues.connection.duplicate({ maxRetriesPerRequest: null });
    this.connections.push(connection, maintenanceConnection);
    this.workers.push(
      new Worker(QUEUE_NAMES.webhooks, (job: Job<{ deliveryId: string }>) => this.deliver(job.data.deliveryId, job.attemptsMade, job.opts.attempts ?? 1), {
        connection,
        concurrency: 5,
      }),
      new Worker(QUEUE_NAMES.maintenance, () => this.maintenance(), { connection: maintenanceConnection, concurrency: 1 }),
    );
    for (const w of this.workers) w.on('error', (err) => this.log.error(`Worker error: ${err.message}`));
    // Expire stale orders and recover lost webhook jobs every 30 seconds.
    void this.queues.maintenance
      .upsertJobScheduler('sweep', { every: 30_000 }, { name: 'sweep', opts: { removeOnComplete: 10, removeOnFail: 50 } })
      .catch((err: Error) => this.log.error(`Could not schedule maintenance: ${err.message}`));
  }

  async maintenance() {
    const expiry = await this.payments.expireStale();
    const requeued = await this.payments.requeueStuckDeliveries();
    const purgedQr = await this.gate.purgeExpiredQr();
    if (expiry.expired || expiry.paid || requeued) this.log.log(`Sweep: ${expiry.expired} expired, ${expiry.paid} paid on status check, ${requeued} webhooks requeued`);
    return { ...expiry, requeued, purgedQr };
  }

  /** One delivery attempt. Throws to ask BullMQ for a retry. */
  async deliver(deliveryId: string, attemptsMade: number, maxAttempts: number): Promise<string> {
    const [row] = await this.db
      .select({ d: merchantWebhookDeliveries, url: merchants.webhookUrl, secretEnc: merchants.webhookSecretEnc })
      .from(merchantWebhookDeliveries)
      .innerJoin(merchants, eq(merchantWebhookDeliveries.merchantId, merchants.id))
      .where(eq(merchantWebhookDeliveries.id, deliveryId));
    if (!row) return 'missing';
    if (row.d.status === 'DELIVERED' || row.d.status === 'FAILED') return row.d.status;
    if (!row.url || !row.secretEnc) {
      await this.finish(deliveryId, 'FAILED', null, 'Merchant has no webhook URL or secret configured');
      return 'FAILED';
    }

    const rawBody = JSON.stringify(row.d.payload);
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = signWebhook(decryptSecret(row.secretEnc, this.env.WEBHOOK_SECRET_ENC_KEY), timestamp, rawBody);
    let status: number | null = null;
    let error: string | null = null;
    try {
      const res = await fetch(row.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'user-agent': 'TicketPay-Webhooks/1.0',
          [WEBHOOK_HEADERS.eventId]: row.d.eventId,
          [WEBHOOK_HEADERS.timestamp]: String(timestamp),
          [WEBHOOK_HEADERS.signature]: signature,
        },
        body: rawBody,
        redirect: 'manual',
        signal: AbortSignal.timeout(10_000),
      });
      status = res.status;
      if (!res.ok) error = `HTTP ${res.status}`;
    } catch (err) {
      error = (err as Error).name === 'TimeoutError' ? 'Timed out after 10s' : (err as Error).message.slice(0, 200);
    }

    if (!error) {
      await this.finish(deliveryId, 'DELIVERED', status, null);
      return 'DELIVERED';
    }
    const attempt = attemptsMade + 1;
    if (attempt >= maxAttempts) {
      await this.finish(deliveryId, 'FAILED', status, error);
      return 'FAILED';
    }
    const nextAttemptAt = new Date(Date.now() + this.env.WEBHOOK_RETRY_BASE_MS * 2 ** attemptsMade);
    await this.db
      .update(merchantWebhookDeliveries)
      .set({ status: 'RETRYING', attemptCount: sql`${merchantWebhookDeliveries.attemptCount} + 1`, lastStatusCode: status, lastError: error, nextAttemptAt })
      .where(eq(merchantWebhookDeliveries.id, deliveryId));
    throw new RetryableDeliveryError(`Delivery ${deliveryId} attempt ${attempt} failed: ${error}`);
  }

  private async finish(deliveryId: string, status: 'DELIVERED' | 'FAILED', code: number | null, error: string | null) {
    await this.db
      .update(merchantWebhookDeliveries)
      .set({
        status,
        attemptCount: sql`${merchantWebhookDeliveries.attemptCount} + 1`,
        lastStatusCode: code,
        lastError: error,
        nextAttemptAt: null,
        deliveredAt: status === 'DELIVERED' ? new Date() : null,
      })
      .where(eq(merchantWebhookDeliveries.id, deliveryId));
  }

  async onApplicationShutdown() {
    await Promise.allSettled(this.workers.map((w) => w.close()));
    for (const c of this.connections) c.disconnect();
  }
}
