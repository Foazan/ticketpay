import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { createId } from '@paralleldrive/cuid2';
import {
  auditLogs,
  ledgerEntries,
  merchantWebhookDeliveries,
  merchants,
  orderItems,
  orders,
  paymentWebhookEvents,
  payments,
  sha256Hex,
  ticketTiers,
  tickets,
} from '@ticketpay/database';
import {
  HOLD_MINUTES,
  type CreatePaymentInput,
  type PaymentStatus,
  type PaymentView,
  type SessionUser,
  type WebhookEventType,
} from '@ticketpay/shared';
import { and, eq, gt, lt } from 'drizzle-orm';
import { AbiCoder, keccak256 } from 'ethers';
import { isUniqueViolation } from '../common/db-errors';
import { newPaymentReference, newValidationCode } from '../common/ids';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { DB, type Database } from '../db/db.module';
import { OrdersService } from '../orders/orders.service';
import { Queues } from '../queue/queue.module';
import { PAYMENT_PROVIDER, ProviderUnavailableError, type PaymentProvider } from './providers/provider';
import { classifyTransition, mapMidtransStatus } from './state-machine';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
type PaymentRow = typeof payments.$inferSelect;

/** Who is asking: a logged-in buyer, or a merchant's server using an API key. */
export type PaymentActor = { kind: 'buyer'; user: SessionUser } | { kind: 'merchant'; merchantId: string };

export type UpdateOutcome = 'APPLIED' | 'DUPLICATE' | 'IGNORED_STALE' | 'UNSUPPORTED' | 'REJECTED';

export interface ProviderUpdate {
  provider: 'MOCK' | 'MIDTRANS';
  /** MOCK, MIDTRANS or SYSTEM (expiry sweeper). */
  source: string;
  reference: string;
  /** Raw provider status, e.g. "settlement". */
  providerStatus: string;
  /** Internal status it maps to, or null when the prototype does not act on it. */
  target: PaymentStatus | null;
  /** Identifies this exact notification; a repeat with the same key has no effect. */
  dedupeKey: string;
  /** Amount the provider reports, for a mismatch check. */
  grossAmount?: string | null;
  paymentType?: string | null;
  transactionId?: string | null;
  /** Provider payload with sensitive fields removed. */
  payload: Record<string, unknown>;
}

const EVENT_FOR: Partial<Record<PaymentStatus, WebhookEventType>> = {
  PAID: 'payment.paid',
  FAILED: 'payment.failed',
  EXPIRED: 'payment.expired',
};

/** keccak256 of (paymentId, merchantId, amount, seq). The only payment data that goes on-chain. */
export function paymentRefHash(paymentId: string, merchantId: string, amount: number, seq: number): string {
  return keccak256(AbiCoder.defaultAbiCoder().encode(['string', 'string', 'uint256', 'uint256'], [paymentId, merchantId, amount, seq]));
}

export function toPaymentView(p: PaymentRow): PaymentView {
  return {
    id: p.id,
    reference: p.reference,
    orderId: p.orderId,
    merchantId: p.merchantId,
    amount: p.amount,
    status: p.status,
    method: p.method,
    provider: p.provider,
    providerStatus: p.providerStatus,
    snapToken: p.snapToken,
    redirectUrl: p.redirectUrl,
    paidAt: p.paidAt?.toISOString() ?? null,
    expiresAt: p.expiresAt.toISOString(),
    createdAt: p.createdAt.toISOString(),
  };
}

@Injectable()
export class PaymentsService {
  private readonly log = new Logger('Payments');

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
    @Inject(PAYMENT_PROVIDER) readonly provider: PaymentProvider,
    private readonly orders: OrdersService,
    private readonly queues: Queues,
  ) {}

  // ---------------------------------------------------------------------------
  // Creating a payment
  // ---------------------------------------------------------------------------

  /**
   * Creates the provider transaction for an order. The same Idempotency-Key with the same body returns
   * the same payment; the same key with a different body is a 409. Returns `replayed` for a repeat.
   */
  async create(actor: PaymentActor, input: CreatePaymentInput, idempotencyKey: string): Promise<{ payment: PaymentView; replayed: boolean }> {
    if (!this.provider.methods().includes(input.method)) {
      throw new BadRequestException(`${input.method} is not enabled for this payment provider`);
    }
    const [order] = await this.db.select().from(orders).where(eq(orders.id, input.orderId));
    const owns = order && (actor.kind === 'buyer' ? order.buyerId === actor.user.id : order.merchantId === actor.merchantId);
    if (!order || !owns) throw new NotFoundException('Order not found');

    // Keys are scoped to whoever sent them, so one client can never collide with or read another's.
    const scopedKey = actor.kind === 'buyer' ? `buyer:${actor.user.id}:${idempotencyKey}` : `merchant:${actor.merchantId}:${idempotencyKey}`;
    const requestHash = sha256Hex(JSON.stringify({ orderId: input.orderId, method: input.method }));

    const replay = await this.findByKey(order.merchantId, scopedKey);
    if (replay) return { payment: await this.ensureProviderTransaction(replay, requestHash), replayed: true };

    const [existingForOrder] = await this.db.select().from(payments).where(eq(payments.orderId, order.id));
    // A concurrent request with the same key may have inserted between the two reads: that is a replay, not a conflict.
    if (existingForOrder?.idempotencyKey === scopedKey) return { payment: await this.ensureProviderTransaction(existingForOrder, requestHash), replayed: true };
    if (existingForOrder) throw new ConflictException('A payment already exists for this order');
    if (order.status !== 'PENDING' || order.holdExpiresAt <= new Date()) {
      throw new ConflictException('This order can no longer be paid. Start a new checkout.');
    }

    let row: PaymentRow;
    try {
      [row] = await this.db
        .insert(payments)
        .values({
          orderId: order.id,
          merchantId: order.merchantId,
          reference: newPaymentReference(),
          idempotencyKey: scopedKey,
          requestHash,
          amount: order.total,
          status: 'PENDING',
          provider: this.provider.kind,
          method: input.method,
          expiresAt: order.holdExpiresAt,
        })
        .returning();
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      // A concurrent request with the same key won the insert.
      const winner = await this.findByKey(order.merchantId, scopedKey);
      if (winner) return { payment: await this.ensureProviderTransaction(winner, requestHash), replayed: true };
      throw new ConflictException('A payment already exists for this order');
    }
    return { payment: await this.ensureProviderTransaction(row, requestHash), replayed: false };
  }

  private async findByKey(merchantId: string, scopedKey: string): Promise<PaymentRow | undefined> {
    const [row] = await this.db
      .select()
      .from(payments)
      .where(and(eq(payments.merchantId, merchantId), eq(payments.idempotencyKey, scopedKey)));
    return row;
  }

  /** Creates the provider transaction if an earlier attempt did not get that far. */
  private async ensureProviderTransaction(row: PaymentRow, requestHash: string): Promise<PaymentView> {
    if (row.requestHash !== requestHash) {
      throw new ConflictException('This Idempotency-Key was already used with a different request body');
    }
    if (row.redirectUrl || row.status !== 'PENDING') return toPaymentView(row);

    const [order] = await this.db.select().from(orders).where(eq(orders.id, row.orderId));
    const items = await this.db
      .select({ tierId: orderItems.tierId, name: ticketTiers.name, price: orderItems.unitPrice, quantity: orderItems.quantity })
      .from(orderItems)
      .innerJoin(ticketTiers, eq(orderItems.tierId, ticketTiers.id))
      .where(eq(orderItems.orderId, order.id));
    try {
      const result = await this.provider.createTransaction({
        paymentId: row.id,
        reference: row.reference,
        orderId: order.id,
        amount: row.amount,
        method: row.method,
        items: [
          ...items.map((i) => ({ id: i.tierId, name: `Ticket - ${i.name}`, price: i.price, quantity: i.quantity })),
          ...(order.serviceFee > 0 ? [{ id: 'service-fee', name: 'TicketPay service fee', price: order.serviceFee, quantity: 1 }] : []),
        ],
        customer: { name: order.buyerName, email: order.buyerEmail, phone: order.buyerPhone },
        holdStartedAt: order.createdAt,
        holdMinutes: HOLD_MINUTES,
      });
      const [updated] = await this.db
        .update(payments)
        .set({ snapToken: result.snapToken, redirectUrl: result.redirectUrl })
        .where(eq(payments.id, row.id))
        .returning();
      return toPaymentView(updated);
    } catch (err) {
      if (err instanceof ProviderUnavailableError) {
        throw new BadGatewayException(`The payment provider is unavailable. Try again with the same Idempotency-Key. (${err.message})`);
      }
      throw err;
    }
  }

  async get(actor: PaymentActor, paymentId: string): Promise<PaymentView> {
    const [row] = await this.db
      .select({ payment: payments, buyerId: orders.buyerId })
      .from(payments)
      .innerJoin(orders, eq(payments.orderId, orders.id))
      .where(eq(payments.id, paymentId));
    const owns = row && (actor.kind === 'buyer' ? row.buyerId === actor.user.id : row.payment.merchantId === actor.merchantId);
    if (!row || !owns) throw new NotFoundException('Payment not found');
    return toPaymentView(row.payment);
  }

  // ---------------------------------------------------------------------------
  // Applying provider updates (Midtrans notifications, mock outcomes, expiry)
  // ---------------------------------------------------------------------------

  /**
   * The only place a payment changes status. In one database transaction it records the notification
   * (unique dedupe key), moves the payment forward if allowed, and applies every business effect:
   * order status, quota, ledger, ticket rows and the merchant webhook. A repeated or out-of-order
   * notification changes nothing.
   */
  async applyUpdate(update: ProviderUpdate): Promise<{ outcome: UpdateOutcome; paymentId: string | null; status: PaymentStatus | null }> {
    const result = await this.db.transaction(async (tx) => {
      const [payment] = await tx
        .select()
        .from(payments)
        .where(eq(payments.reference, update.reference))
        .for('update');

      const record = async (outcome: UpdateOutcome) => {
        const inserted = await tx
          .insert(paymentWebhookEvents)
          .values({
            provider: update.provider,
            source: update.source,
            paymentId: payment?.id ?? null,
            dedupeKey: update.dedupeKey,
            signatureValid: true,
            providerStatus: update.providerStatus,
            outcome,
            payloadRedacted: update.payload,
          })
          .onConflictDoNothing({ target: paymentWebhookEvents.dedupeKey })
          .returning({ id: paymentWebhookEvents.id });
        return inserted.length > 0;
      };

      if (!payment) {
        await record('UNSUPPORTED');
        return { outcome: 'UNSUPPORTED' as const, paymentId: null, status: null, deliveries: [] as string[] };
      }
      if (update.grossAmount != null && update.grossAmount !== '' && Math.round(Number(update.grossAmount)) !== payment.amount) {
        const fresh = await record('REJECTED');
        if (fresh) {
          await tx.insert(auditLogs).values({
            actorRole: 'SYSTEM',
            action: 'payment.amount_mismatch',
            entityType: 'Payment',
            entityId: payment.id,
            metadata: { reported: update.grossAmount, expected: payment.amount, source: update.source },
          });
        }
        return { outcome: 'REJECTED' as const, paymentId: payment.id, status: payment.status, deliveries: [] };
      }

      const transition = update.target ? classifyTransition(payment.status, update.target) : null;
      const outcome: UpdateOutcome =
        transition === null ? 'UNSUPPORTED' : transition === 'forward' ? 'APPLIED' : transition === 'same' ? 'DUPLICATE' : 'IGNORED_STALE';
      if (!(await record(outcome))) {
        return { outcome: 'DUPLICATE' as const, paymentId: payment.id, status: payment.status, deliveries: [] };
      }
      if (outcome !== 'APPLIED' || !update.target) {
        if (outcome === 'IGNORED_STALE') {
          this.log.warn(`Ignored ${update.providerStatus} for ${payment.reference}: payment is already ${payment.status}`);
        }
        return { outcome, paymentId: payment.id, status: payment.status, deliveries: [] };
      }

      const deliveries = await this.moveForward(tx, payment, update);
      return { outcome, paymentId: payment.id, status: update.target, deliveries };
    });

    // After commit: a queue outage cannot roll back a verified payment. The sweeps re-enqueue.
    for (const id of result.deliveries) await this.queues.enqueueWebhook(id);
    // Minting starts only here: after the PAID transition is committed, which only a verified provider update can cause.
    if (result.outcome === 'APPLIED' && result.status === 'PAID' && result.paymentId) {
      const issued = await this.db.select({ id: tickets.id }).from(tickets).where(eq(tickets.paymentId, result.paymentId)).orderBy(tickets.seq);
      for (const t of issued) await this.queues.enqueueMint(t.id);
    }
    return { outcome: result.outcome, paymentId: result.paymentId, status: result.status };
  }

  private async moveForward(tx: Tx, payment: PaymentRow, update: ProviderUpdate): Promise<string[]> {
    const target = update.target!;
    const now = new Date();
    await tx
      .update(payments)
      .set({
        status: target,
        providerStatus: update.providerStatus,
        paymentType: update.paymentType ?? payment.paymentType,
        providerTransactionId: update.transactionId ?? payment.providerTransactionId,
        paidAt: target === 'PAID' ? now : payment.paidAt,
      })
      .where(eq(payments.id, payment.id));

    const [order] = await tx.select().from(orders).where(eq(orders.id, payment.orderId)).for('update');

    if (target === 'PAID') {
      await this.orders.convertHoldToSold(tx, order.id);
      await tx.update(orders).set({ status: 'PAID' }).where(eq(orders.id, order.id));
      await this.writeSaleLedger(tx, payment, order);
      await this.issueTickets(tx, payment, order);
    } else if (target === 'FAILED' || target === 'EXPIRED') {
      if (order.status === 'PENDING') {
        await this.orders.releaseHold(tx, order.id);
        await tx.update(orders).set({ status: target }).where(eq(orders.id, order.id));
      }
    } else if (target === 'REFUNDED') {
      // Recorded only. TicketPay does not move real money; a refund reported by the provider is mirrored here.
      await tx.update(orders).set({ status: 'REFUNDED' }).where(eq(orders.id, order.id));
      await tx.update(tickets).set({ status: 'CANCELLED' }).where(eq(tickets.paymentId, payment.id));
      await tx
        .insert(ledgerEntries)
        .values({
          merchantId: payment.merchantId,
          paymentId: payment.id,
          type: 'REFUND',
          direction: 'DEBIT',
          amount: payment.amount,
          description: `Refund reported by ${update.source}`,
          dedupeKey: `${payment.id}:REFUND`,
        })
        .onConflictDoNothing();
    }

    await tx.insert(auditLogs).values({
      actorRole: 'SYSTEM',
      action: 'payment.status_changed',
      entityType: 'Payment',
      entityId: payment.id,
      metadata: { from: payment.status, to: target, source: update.source, providerStatus: update.providerStatus },
    });

    return this.createWebhookDelivery(tx, payment, order, target, now);
  }

  /** Append-only ledger lines for a paid order. Unique dedupe keys make a replay a no-op. */
  private async writeSaleLedger(tx: Tx, payment: PaymentRow, order: typeof orders.$inferSelect) {
    await tx
      .insert(ledgerEntries)
      .values([
        {
          merchantId: payment.merchantId,
          paymentId: payment.id,
          type: 'GROSS_SALE',
          direction: 'CREDIT',
          amount: payment.amount,
          description: `Order ${order.orderNumber}: amount collected by the provider (tickets plus service fee)`,
          dedupeKey: `${payment.id}:GROSS_SALE`,
        },
        {
          merchantId: payment.merchantId,
          paymentId: payment.id,
          type: 'SERVICE_FEE',
          direction: 'DEBIT',
          amount: order.serviceFee,
          description: `TicketPay service fee at ${(order.feeRateBps / 100).toFixed(2)}% of ticket subtotal`,
          dedupeKey: `${payment.id}:SERVICE_FEE`,
        },
        {
          merchantId: payment.merchantId,
          paymentId: payment.id,
          type: 'MERCHANT_NET',
          direction: 'CREDIT',
          amount: order.subtotal,
          // The provider fee is unknown in the sandbox, so it is not deducted here.
          description: 'Estimated organizer net before provider fees. Internal estimate, not settled funds.',
          dedupeKey: `${payment.id}:MERCHANT_NET`,
        },
      ])
      .onConflictDoNothing();
  }

  /**
   * Creates one ticket row per seat, owned by the buyer, with mintStatus PENDING.
   * The chain worker mints them after commit (see applyUpdate). Unique (paymentId, seq) makes this idempotent.
   */
  private async issueTickets(tx: Tx, payment: PaymentRow, order: typeof orders.$inferSelect) {
    const items = await tx.select().from(orderItems).where(eq(orderItems.orderId, order.id)).orderBy(orderItems.id);
    const rows: (typeof tickets.$inferInsert)[] = [];
    let seq = 0;
    for (const item of items) {
      for (let i = 0; i < item.quantity; i++) {
        seq++;
        rows.push({
          orderId: order.id,
          orderItemId: item.id,
          ownerId: order.buyerId,
          eventId: order.eventId,
          tierId: item.tierId,
          paymentId: payment.id,
          seq,
          paymentRefHash: paymentRefHash(payment.id, payment.merchantId, payment.amount, seq),
          validationCode: newValidationCode(),
          status: 'ACTIVE',
          mintStatus: 'PENDING',
        });
      }
    }
    if (rows.length) await tx.insert(tickets).values(rows).onConflictDoNothing({ target: [tickets.paymentId, tickets.seq] });
  }

  private async createWebhookDelivery(
    tx: Tx,
    payment: PaymentRow,
    order: typeof orders.$inferSelect,
    status: PaymentStatus,
    at: Date,
  ): Promise<string[]> {
    const type = EVENT_FOR[status];
    if (!type) return [];
    const [merchant] = await tx.select({ webhookUrl: merchants.webhookUrl }).from(merchants).where(eq(merchants.id, payment.merchantId));
    if (!merchant?.webhookUrl) return [];
    const eventId = `evt_${createId()}`;
    const inserted = await tx
      .insert(merchantWebhookDeliveries)
      .values({
        eventId,
        merchantId: payment.merchantId,
        paymentId: payment.id,
        eventType: type,
        payload: {
          id: eventId,
          type,
          created_at: at.toISOString(),
          merchant_id: payment.merchantId,
          payment_reference: payment.reference,
          data: {
            payment_id: payment.id,
            order_id: order.id,
            order_number: order.orderNumber,
            amount: payment.amount,
            currency: 'IDR',
            status,
            method: payment.method,
            paid_at: status === 'PAID' ? at.toISOString() : null,
          },
        },
      })
      .onConflictDoNothing({ target: [merchantWebhookDeliveries.paymentId, merchantWebhookDeliveries.eventType] })
      .returning({ id: merchantWebhookDeliveries.id });
    return inserted.map((r) => r.id);
  }

  // ---------------------------------------------------------------------------
  // Expiry
  // ---------------------------------------------------------------------------

  /**
   * Expires orders whose hold ran out. Waits EXPIRY_GRACE_MS past the hold so a late provider
   * notification can still arrive. For Midtrans payments it asks Midtrans first, so a payment
   * that did succeed is applied as PAID rather than expired.
   */
  async expireStale(now = new Date()): Promise<{ expired: number; paid: number }> {
    const cutoff = new Date(now.getTime() - this.env.EXPIRY_GRACE_MS);
    const stale = await this.db
      .select({ orderId: orders.id, paymentId: payments.id, reference: payments.reference, provider: payments.provider, amount: payments.amount })
      .from(orders)
      .leftJoin(payments, eq(payments.orderId, orders.id))
      .where(and(eq(orders.status, 'PENDING'), lt(orders.holdExpiresAt, cutoff)))
      .limit(200);

    let expired = 0;
    let paid = 0;
    for (const s of stale) {
      if (!s.paymentId || !s.reference) {
        // Checkout abandoned before payment: release the hold directly.
        const done = await this.db.transaction(async (tx) => {
          const [o] = await tx.select().from(orders).where(and(eq(orders.id, s.orderId), eq(orders.status, 'PENDING'))).for('update');
          if (!o) return false;
          const [p] = await tx.select({ id: payments.id }).from(payments).where(eq(payments.orderId, o.id));
          if (p) return false; // A payment appeared meanwhile; the next sweep handles it.
          await this.orders.releaseHold(tx, o.id);
          await tx.update(orders).set({ status: 'EXPIRED' }).where(eq(orders.id, o.id));
          return true;
        });
        if (done) expired++;
        continue;
      }
      if (s.provider === 'MIDTRANS') {
        try {
          const status = await this.provider.getStatus(s.reference);
          const target = status ? mapMidtransStatus(status.transactionStatus, status.fraudStatus) : null;
          if (status && target && target !== 'PENDING') {
            const r = await this.applyUpdate({
              provider: 'MIDTRANS',
              source: 'SYSTEM',
              reference: s.reference,
              providerStatus: status.transactionStatus,
              target,
              dedupeKey: `MIDTRANS:${s.reference}:${status.transactionStatus}:${status.statusCode}:${status.fraudStatus ?? ''}`,
              grossAmount: status.grossAmount,
              paymentType: status.paymentType,
              transactionId: status.transactionId,
              payload: { order_id: s.reference, transaction_status: status.transactionStatus, status_code: status.statusCode, via: 'status_api' },
            });
            if (r.status === 'PAID') paid++;
            if (r.status === 'EXPIRED' || r.status === 'FAILED') expired++;
            continue;
          }
        } catch (err) {
          // Midtrans unreachable: leave the order for the next sweep rather than guessing.
          this.log.warn(`Expiry check for ${s.reference} skipped: ${(err as Error).message}`);
          continue;
        }
      }
      const r = await this.applyUpdate({
        provider: s.provider ?? 'MOCK',
        source: 'SYSTEM',
        reference: s.reference,
        providerStatus: 'expire',
        target: 'EXPIRED',
        dedupeKey: `SYSTEM:expire:${s.reference}`,
        payload: { reason: 'hold expired', at: now.toISOString() },
      });
      if (r.outcome === 'APPLIED') expired++;
    }
    return { expired, paid };
  }

  /** Re-enqueues deliveries whose job may have been lost (for example Redis was down at commit time). */
  async requeueStuckDeliveries(now = new Date()): Promise<number> {
    const rows = await this.db
      .select({ id: merchantWebhookDeliveries.id })
      .from(merchantWebhookDeliveries)
      .where(
        and(
          eq(merchantWebhookDeliveries.status, 'PENDING'),
          eq(merchantWebhookDeliveries.attemptCount, 0),
          lt(merchantWebhookDeliveries.createdAt, new Date(now.getTime() - 60_000)),
          gt(merchantWebhookDeliveries.createdAt, new Date(now.getTime() - 24 * 3600_000)),
        ),
      )
      .limit(100);
    for (const r of rows) await this.queues.enqueueWebhook(r.id);
    return rows.length;
  }

  /** Records a notification whose signature failed. Kept outside any business transaction. */
  async recordRejected(provider: 'MIDTRANS' | 'MOCK', payload: Record<string, unknown>, reason: string, ip?: string) {
    await this.db.insert(paymentWebhookEvents).values({
      provider,
      source: provider,
      paymentId: null,
      dedupeKey: `rejected:${createId()}`,
      signatureValid: false,
      providerStatus: typeof payload.transaction_status === 'string' ? payload.transaction_status : null,
      outcome: 'REJECTED',
      payloadRedacted: payload,
    });
    await this.db.insert(auditLogs).values({
      actorRole: 'SYSTEM',
      action: 'webhook.signature_rejected',
      entityType: 'PaymentWebhookEvent',
      metadata: { provider, reason, orderId: payload.order_id ?? null },
      ipAddress: ip ?? null,
    });
  }
}

