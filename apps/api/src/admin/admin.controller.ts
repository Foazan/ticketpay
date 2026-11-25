import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  DefaultValuePipe,
  Delete,
  Get,
  HttpCode,
  Inject,
  Ip,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  Query,
} from '@nestjs/common';
import {
  auditLogs,
  blockchainTransactions,
  events,
  gateEventPermissions,
  ledgerEntries,
  merchantApiKeys,
  merchants,
  merchantWebhookDeliveries,
  orderItems,
  orders,
  paymentWebhookEvents,
  payments,
  platformFeeSettings,
  ticketRedemptions,
  ticketTiers,
  tickets,
  users,
} from '@ticketpay/database';
import {
  createGateStaffSchema,
  feeSettingSchema,
  gateAssignmentSchema,
  merchantDecisionSchema,
  refundSchema,
  type CreateGateStaffInput,
  type FeeSettingInput,
  type MerchantDecisionInput,
  type RefundInput,
  type SessionUser,
} from '@ticketpay/shared';
import * as argon2 from 'argon2';
import { aliasedTable, and, asc, count, desc, eq, gte, ilike, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { ChainClient } from '../chain/chain.client';
import { isUniqueViolation } from '../common/db-errors';
import { CurrentUser, Roles } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { DB, type Database } from '../db/db.module';
import { FeesService } from '../payments/fees.service';
import { PaymentsService } from '../payments/payments.service';
import { Queues } from '../queue/queue.module';
import { ReconciliationService } from '../reconciliation/reconciliation.service';

const num = (q: SQL<unknown>) => q.mapWith(Number);
const day = (col: unknown) => sql<string>`to_char(${col} at time zone 'Asia/Jakarta', 'YYYY-MM-DD')`;
/** Correlated subqueries in single-table selects need the outer id written out (see organizer controller). */
const EVENT_ID = sql.raw('"events"."id"');
const MERCHANT_ID = sql.raw('"merchants"."id"');

type Decision = 'approve' | 'reject' | 'suspend';
const DECISIONS: Record<Decision, { from: string[]; to: 'APPROVED' | 'REJECTED' | 'SUSPENDED'; needsReason: boolean }> = {
  approve: { from: ['PENDING', 'REJECTED', 'SUSPENDED'], to: 'APPROVED', needsReason: false },
  reject: { from: ['PENDING'], to: 'REJECTED', needsReason: true },
  suspend: { from: ['APPROVED'], to: 'SUSPENDED', needsReason: true },
};

/**
 * Platform administration (brief Part 11). Every figure comes from the database. Every change an
 * administrator makes is written to the audit log with their id and address.
 */
@Roles('ADMIN')
@Controller('v1/admin')
export class AdminController {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly fees: FeesService,
    private readonly recon: ReconciliationService,
    private readonly chain: ChainClient,
    private readonly queues: Queues,
  ) {}

  // ---------- Overview ----------

  @Get('overview')
  async overview() {
    const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' });
    const today = fmt.format(new Date());
    const keys = Array.from({ length: 30 }, (_, i) => fmt.format(new Date(Date.parse(`${today}T12:00:00Z`) - (29 - i) * 24 * 3600 * 1000)));
    const since = new Date(`${keys[0]}T00:00:00+07:00`);
    const byStatus = (rows: { status: string; total: number }[]) => Object.fromEntries(rows.map((r) => [r.status, Number(r.total)]));
    const [merchantRows, eventRows, paymentRows, [money], [tix], [webhooks], daily, recon, chain, fee] = await Promise.all([
      this.db.select({ status: merchants.status, total: count() }).from(merchants).where(isNull(merchants.deletedAt)).groupBy(merchants.status),
      this.db.select({ status: events.status, total: count() }).from(events).where(isNull(events.deletedAt)).groupBy(events.status),
      this.db.select({ status: payments.status, total: count() }).from(payments).groupBy(payments.status),
      this.db
        .select({
          gross: num(sql`coalesce(sum(case when ${ledgerEntries.type} = 'GROSS_SALE' then ${ledgerEntries.amount} else 0 end), 0)`),
          refunds: num(sql`coalesce(sum(case when ${ledgerEntries.type} = 'REFUND' then ${ledgerEntries.amount} else 0 end), 0)`),
          serviceFees: num(
            sql`coalesce(sum(case when ${ledgerEntries.type} = 'SERVICE_FEE' then (case when ${ledgerEntries.direction} = 'DEBIT' then ${ledgerEntries.amount} else -${ledgerEntries.amount} end) else 0 end), 0)`,
          ),
        })
        .from(ledgerEntries),
      this.db
        .select({
          issued: count(),
          minted: num(sql`count(*) filter (where ${tickets.mintStatus} = 'MINTED')`),
          mintFailed: num(sql`count(*) filter (where ${tickets.mintStatus} = 'FAILED' and ${tickets.status} <> 'CANCELLED')`),
          redeemed: num(sql`count(*) filter (where ${tickets.status} = 'REDEEMED')`),
        })
        .from(tickets),
      this.db
        .select({ failed: num(sql`count(*) filter (where ${merchantWebhookDeliveries.status} = 'FAILED')`), retrying: num(sql`count(*) filter (where ${merchantWebhookDeliveries.status} = 'RETRYING')`) })
        .from(merchantWebhookDeliveries),
      this.db
        .select({ date: day(payments.paidAt), volume: num(sql`coalesce(sum(${payments.amount}), 0)`) })
        .from(payments)
        .where(and(inArray(payments.status, ['PAID', 'REFUNDED', 'REFUND_PENDING']), gte(payments.paidAt, since)))
        .groupBy(day(payments.paidAt)),
      this.recon.report({ limit: 500 }),
      this.chain.status(),
      this.fees.currentRateBps(),
    ]);
    const volumeBy = new Map(daily.map((d) => [d.date, d.volume]));
    return {
      merchants: byStatus(merchantRows),
      events: byStatus(eventRows),
      payments: byStatus(paymentRows),
      money,
      tickets: { issued: Number(tix.issued), minted: tix.minted, mintFailed: tix.mintFailed, redeemed: tix.redeemed },
      webhooks,
      dailyVolume: keys.map((date) => ({ date, tickets: 0, revenue: volumeBy.get(date) ?? 0 })),
      reconciliation: recon.summary,
      chain,
      feeRateBps: fee,
    };
  }

  // ---------- Merchants ----------

  @Get('merchants')
  listMerchants(@Query('status') status?: string) {
    const where: SQL[] = [isNull(merchants.deletedAt)];
    if (status && ['PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED'].includes(status)) where.push(eq(merchants.status, status as 'PENDING'));
    return this.db
      .select({
        id: merchants.id,
        businessName: merchants.businessName,
        organizerType: merchants.organizerType,
        contactPerson: merchants.contactPerson,
        phone: merchants.phone,
        status: merchants.status,
        statusReason: merchants.statusReason,
        email: users.email,
        createdAt: merchants.createdAt,
        eventCount: num(sql`(select count(*) from events e where e.merchant_id = ${MERCHANT_ID} and e.deleted_at is null)`),
        grossVolume: num(sql`(select coalesce(sum(p.amount), 0) from payments p where p.merchant_id = ${MERCHANT_ID} and p.status = 'PAID')`),
      })
      .from(merchants)
      .innerJoin(users, eq(merchants.userId, users.id))
      .where(and(...where))
      .orderBy(sql`case ${merchants.status} when 'PENDING' then 0 else 1 end`, desc(merchants.createdAt));
  }

  @Get('merchants/:id')
  async merchantDetail(@Param('id') id: string) {
    const [m] = await this.db
      .select({
        id: merchants.id,
        businessName: merchants.businessName,
        organizerType: merchants.organizerType,
        contactPerson: merchants.contactPerson,
        phone: merchants.phone,
        address: merchants.address,
        description: merchants.description,
        settlementAccountNote: merchants.settlementAccountNote,
        status: merchants.status,
        statusReason: merchants.statusReason,
        webhookUrl: merchants.webhookUrl,
        createdAt: merchants.createdAt,
        email: users.email,
        fullName: users.fullName,
      })
      .from(merchants)
      .innerJoin(users, eq(merchants.userId, users.id))
      .where(and(eq(merchants.id, id), isNull(merchants.deletedAt)));
    if (!m) throw new NotFoundException('Merchant not found');
    const [evs, [keys], [pay], history] = await Promise.all([
      this.db
        .select({ id: events.id, title: events.title, status: events.status, startAt: events.startAt })
        .from(events)
        .where(and(eq(events.merchantId, id), isNull(events.deletedAt)))
        .orderBy(desc(events.startAt)),
      this.db.select({ n: count() }).from(merchantApiKeys).where(and(eq(merchantApiKeys.merchantId, id), isNull(merchantApiKeys.revokedAt))),
      this.db
        .select({ paid: num(sql`count(*) filter (where ${payments.status} = 'PAID')`), volume: num(sql`coalesce(sum(${payments.amount}) filter (where ${payments.status} = 'PAID'), 0)`) })
        .from(payments)
        .where(eq(payments.merchantId, id)),
      this.db
        .select({ action: auditLogs.action, metadata: auditLogs.metadata, createdAt: auditLogs.createdAt, actor: users.fullName })
        .from(auditLogs)
        .leftJoin(users, eq(auditLogs.actorId, users.id))
        .where(and(eq(auditLogs.entityType, 'Merchant'), eq(auditLogs.entityId, id)))
        .orderBy(desc(auditLogs.createdAt))
        .limit(20),
    ]);
    return { ...m, events: evs, activeApiKeys: Number(keys.n), paidPayments: pay.paid, grossVolume: pay.volume, history };
  }

  @Post('merchants/:id/:decision')
  @HttpCode(200)
  async decide(
    @CurrentUser() admin: SessionUser,
    @Param('id') id: string,
    @Param('decision') decision: string,
    @Body(new ZodPipe(merchantDecisionSchema)) body: MerchantDecisionInput,
    @Ip() ip: string,
  ) {
    const rule = DECISIONS[decision as Decision];
    if (!rule) throw new NotFoundException();
    if (rule.needsReason && body.reason.length < 5) throw new BadRequestException('Give the organizer a reason (at least 5 characters)');
    const [m] = await this.db.select({ status: merchants.status }).from(merchants).where(and(eq(merchants.id, id), isNull(merchants.deletedAt)));
    if (!m) throw new NotFoundException('Merchant not found');
    if (!rule.from.includes(m.status)) throw new ConflictException(`A ${m.status.toLowerCase()} merchant cannot be ${rule.to.toLowerCase()}`);
    // Conditional on the status read above, so two administrators cannot both act on stale data.
    const updated = await this.db
      .update(merchants)
      .set({ status: rule.to, statusReason: body.reason || null })
      .where(and(eq(merchants.id, id), eq(merchants.status, m.status)))
      .returning({ id: merchants.id });
    if (!updated.length) throw new ConflictException('The merchant changed in the meantime. Reload and try again.');
    await this.audit.record({
      actorId: admin.id,
      actorRole: admin.role,
      action: `merchant.${rule.to.toLowerCase()}`,
      entityType: 'Merchant',
      entityId: id,
      metadata: { from: m.status, reason: body.reason || null },
      ipAddress: ip,
    });
    return this.merchantDetail(id);
  }

  // ---------- Events ----------

  @Get('events')
  listEvents(@Query('status') status?: string) {
    const where: SQL[] = [isNull(events.deletedAt)];
    if (status && ['DRAFT', 'PUBLISHED', 'UNPUBLISHED', 'ARCHIVED'].includes(status)) where.push(eq(events.status, status as 'DRAFT'));
    return this.db
      .select({
        id: events.id,
        slug: events.slug,
        title: events.title,
        city: events.city,
        startAt: events.startAt,
        status: events.status,
        merchantId: merchants.id,
        merchant: merchants.businessName,
        merchantStatus: merchants.status,
        sold: num(sql`(select coalesce(sum(tt.sold_count), 0) from ticket_tiers tt where tt.event_id = ${EVENT_ID})`),
        quota: num(sql`(select coalesce(sum(tt.quota), 0) from ticket_tiers tt where tt.event_id = ${EVENT_ID})`),
        gateStaff: num(sql`(select count(*) from gate_event_permissions g where g.event_id = ${EVENT_ID})`),
      })
      .from(events)
      .innerJoin(merchants, eq(events.merchantId, merchants.id))
      .where(and(...where))
      .orderBy(desc(events.startAt));
  }

  /** Moderation: takes an event off sale. Tickets already sold stay valid; the organizer can publish again. */
  @Post('events/:id/unpublish')
  @HttpCode(200)
  async unpublishEvent(@CurrentUser() admin: SessionUser, @Param('id') id: string, @Body(new ZodPipe(merchantDecisionSchema)) body: MerchantDecisionInput, @Ip() ip: string) {
    if (body.reason.length < 5) throw new BadRequestException('Give a reason (at least 5 characters)');
    const updated = await this.db
      .update(events)
      .set({ status: 'UNPUBLISHED' })
      .where(and(eq(events.id, id), eq(events.status, 'PUBLISHED'), isNull(events.deletedAt)))
      .returning({ id: events.id });
    if (!updated.length) throw new ConflictException('Only a published event can be unpublished');
    await this.audit.record({ actorId: admin.id, actorRole: admin.role, action: 'event.unpublished_by_admin', entityType: 'Event', entityId: id, metadata: { reason: body.reason }, ipAddress: ip });
    return { id, status: 'UNPUBLISHED' };
  }

  // ---------- Payments ----------

  @Get('payments')
  listPayments(@Query('status') status?: string, @Query('merchantId') merchantId?: string, @Query('q') q?: string) {
    const where: SQL[] = [];
    if (status && ['PENDING', 'PAID', 'FAILED', 'EXPIRED', 'REFUND_PENDING', 'REFUNDED'].includes(status)) where.push(eq(payments.status, status as 'PAID'));
    if (merchantId) where.push(eq(payments.merchantId, merchantId));
    if (q?.trim()) {
      const like = `%${q.trim().replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
      where.push(or(ilike(payments.reference, like), ilike(orders.orderNumber, like), ilike(orders.buyerName, like))!);
    }
    return this.db
      .select({
        id: payments.id,
        reference: payments.reference,
        orderNumber: orders.orderNumber,
        buyerName: orders.buyerName,
        merchantId: merchants.id,
        merchant: merchants.businessName,
        event: events.title,
        amount: payments.amount,
        method: payments.method,
        provider: payments.provider,
        status: payments.status,
        providerStatus: payments.providerStatus,
        paidAt: payments.paidAt,
        createdAt: payments.createdAt,
      })
      .from(payments)
      .innerJoin(orders, eq(payments.orderId, orders.id))
      .innerJoin(events, eq(orders.eventId, events.id))
      .innerJoin(merchants, eq(payments.merchantId, merchants.id))
      .where(where.length ? and(...where) : undefined)
      .orderBy(desc(payments.createdAt))
      .limit(200);
  }

  /** Everything recorded about one payment: order, provider notifications, ledger, tickets, merchant webhooks. */
  @Get('payments/:id')
  async paymentDetail(@Param('id') id: string) {
    const [p] = await this.db
      .select({
        payment: payments,
        order: orders,
        merchant: merchants.businessName,
        event: events.title,
      })
      .from(payments)
      .innerJoin(orders, eq(payments.orderId, orders.id))
      .innerJoin(events, eq(orders.eventId, events.id))
      .innerJoin(merchants, eq(payments.merchantId, merchants.id))
      .where(eq(payments.id, id));
    if (!p) throw new NotFoundException('Payment not found');
    const [items, notifications, ledger, ticketRows, deliveries] = await Promise.all([
      this.db
        .select({ tier: ticketTiers.name, quantity: orderItems.quantity, unitPrice: orderItems.unitPrice })
        .from(orderItems)
        .innerJoin(ticketTiers, eq(orderItems.tierId, ticketTiers.id))
        .where(eq(orderItems.orderId, p.order.id)),
      this.db
        .select({
          id: paymentWebhookEvents.id,
          source: paymentWebhookEvents.source,
          providerStatus: paymentWebhookEvents.providerStatus,
          outcome: paymentWebhookEvents.outcome,
          signatureValid: paymentWebhookEvents.signatureValid,
          receivedAt: paymentWebhookEvents.receivedAt,
        })
        .from(paymentWebhookEvents)
        .where(eq(paymentWebhookEvents.paymentId, id))
        .orderBy(asc(paymentWebhookEvents.receivedAt)),
      this.db.select().from(ledgerEntries).where(eq(ledgerEntries.paymentId, id)).orderBy(asc(ledgerEntries.createdAt)),
      this.db
        .select({
          id: tickets.id,
          seq: tickets.seq,
          status: tickets.status,
          mintStatus: tickets.mintStatus,
          tokenId: tickets.tokenId,
          redeemedAt: ticketRedemptions.redeemedAt,
          redeemChainStatus: ticketRedemptions.chainStatus,
        })
        .from(tickets)
        .leftJoin(ticketRedemptions, eq(ticketRedemptions.ticketId, tickets.id))
        .where(eq(tickets.paymentId, id))
        .orderBy(asc(tickets.seq)),
      this.db
        .select({
          id: merchantWebhookDeliveries.id,
          eventType: merchantWebhookDeliveries.eventType,
          status: merchantWebhookDeliveries.status,
          attemptCount: merchantWebhookDeliveries.attemptCount,
          lastStatusCode: merchantWebhookDeliveries.lastStatusCode,
          lastError: merchantWebhookDeliveries.lastError,
          createdAt: merchantWebhookDeliveries.createdAt,
        })
        .from(merchantWebhookDeliveries)
        .where(eq(merchantWebhookDeliveries.paymentId, id))
        .orderBy(asc(merchantWebhookDeliveries.createdAt)),
    ]);
    const txs = ticketRows.length
      ? await this.db
          .select({ ticketId: blockchainTransactions.ticketId, type: blockchainTransactions.type, status: blockchainTransactions.status, txHash: blockchainTransactions.txHash, errorMessage: blockchainTransactions.errorMessage })
          .from(blockchainTransactions)
          .where(inArray(blockchainTransactions.ticketId, ticketRows.map((t) => t.id)))
          .orderBy(asc(blockchainTransactions.createdAt))
      : [];
    const { payment, order } = p;
    return {
      payment: {
        id: payment.id,
        reference: payment.reference,
        provider: payment.provider,
        providerTransactionId: payment.providerTransactionId,
        method: payment.method,
        amount: payment.amount,
        status: payment.status,
        providerStatus: payment.providerStatus,
        paidAt: payment.paidAt,
        createdAt: payment.createdAt,
      },
      order: {
        id: order.id,
        orderNumber: order.orderNumber,
        status: order.status,
        buyerName: order.buyerName,
        subtotal: order.subtotal,
        serviceFee: order.serviceFee,
        feeRateBps: order.feeRateBps,
        total: order.total,
        createdAt: order.createdAt,
      },
      merchant: p.merchant,
      event: p.event,
      items,
      notifications,
      ledger,
      tickets: ticketRows.map((t) => ({
        ...t,
        chain: txs.filter((x) => x.ticketId === t.id).map((x) => ({ ...x, txUrl: x.txHash ? this.chain.config.explorerTxUrl(x.txHash) : null })),
      })),
      deliveries,
      canRefund: payment.status === 'PAID' && !ticketRows.some((t) => t.status === 'REDEEMED'),
    };
  }

  // ---------- Ledger and reconciliation ----------

  @Get('ledger')
  async ledger(@Query('merchantId') merchantId?: string, @Query('type') type?: string) {
    const where: SQL[] = [];
    if (merchantId) where.push(eq(ledgerEntries.merchantId, merchantId));
    if (type && ['GROSS_SALE', 'SERVICE_FEE', 'PROVIDER_FEE', 'MERCHANT_NET', 'REFUND', 'ADJUSTMENT'].includes(type)) where.push(eq(ledgerEntries.type, type as 'REFUND'));
    const filter = where.length ? and(...where) : undefined;
    const [rows, totals] = await Promise.all([
      this.db
        .select({
          id: ledgerEntries.id,
          merchant: merchants.businessName,
          paymentReference: payments.reference,
          paymentId: ledgerEntries.paymentId,
          type: ledgerEntries.type,
          direction: ledgerEntries.direction,
          amount: ledgerEntries.amount,
          description: ledgerEntries.description,
          createdAt: ledgerEntries.createdAt,
        })
        .from(ledgerEntries)
        .innerJoin(merchants, eq(ledgerEntries.merchantId, merchants.id))
        .innerJoin(payments, eq(ledgerEntries.paymentId, payments.id))
        .where(filter)
        .orderBy(desc(ledgerEntries.createdAt))
        .limit(300),
      this.db
        .select({
          type: ledgerEntries.type,
          credit: num(sql`coalesce(sum(${ledgerEntries.amount}) filter (where ${ledgerEntries.direction} = 'CREDIT'), 0)`),
          debit: num(sql`coalesce(sum(${ledgerEntries.amount}) filter (where ${ledgerEntries.direction} = 'DEBIT'), 0)`),
        })
        .from(ledgerEntries)
        .where(filter)
        .groupBy(ledgerEntries.type),
    ]);
    return { rows, totals };
  }

  @Get('reconciliation')
  async reconciliation(@Query('merchantId') merchantId?: string) {
    const report = await this.recon.report({ merchantId: merchantId || undefined, limit: 500 });
    const names = new Map(
      (await this.db.select({ id: payments.id, merchant: merchants.businessName }).from(payments).innerJoin(merchants, eq(payments.merchantId, merchants.id)).where(
        report.rows.length ? inArray(payments.id, report.rows.map((r) => r.paymentId)) : sql`false`,
      )).map((r) => [r.id, r.merchant]),
    );
    return { ...report, rows: report.rows.map((r) => ({ ...r, merchant: names.get(r.paymentId) ?? '' })) };
  }

  // ---------- Fee settings ----------

  @Get('fees')
  async feeSettings() {
    const history = await this.db
      .select({ id: platformFeeSettings.id, feeRateBps: platformFeeSettings.feeRateBps, effectiveFrom: platformFeeSettings.effectiveFrom, note: platformFeeSettings.note, setBy: users.fullName })
      .from(platformFeeSettings)
      .leftJoin(users, eq(platformFeeSettings.setById, users.id))
      .orderBy(desc(platformFeeSettings.effectiveFrom))
      .limit(50);
    return { currentRateBps: await this.fees.currentRateBps(), history };
  }

  /** A new rate applies to orders created from now on. Existing orders keep the rate they were quoted. */
  @Post('fees')
  async setFee(@CurrentUser() admin: SessionUser, @Body(new ZodPipe(feeSettingSchema)) body: FeeSettingInput, @Ip() ip: string) {
    const previous = await this.fees.currentRateBps();
    await this.db.insert(platformFeeSettings).values({ feeRateBps: body.feeRateBps, effectiveFrom: new Date(), setById: admin.id, note: body.note || null });
    await this.audit.record({ actorId: admin.id, actorRole: admin.role, action: 'fee.changed', entityType: 'PlatformFee', metadata: { from: previous, to: body.feeRateBps, note: body.note || null }, ipAddress: ip });
    return this.feeSettings();
  }

  // ---------- Merchant webhooks ----------

  @Get('webhooks')
  webhookDeliveries(@Query('status') status?: string) {
    const where: SQL[] = [];
    if (status && ['PENDING', 'DELIVERED', 'RETRYING', 'FAILED'].includes(status)) where.push(eq(merchantWebhookDeliveries.status, status as 'FAILED'));
    return this.db
      .select({
        id: merchantWebhookDeliveries.id,
        eventId: merchantWebhookDeliveries.eventId,
        eventType: merchantWebhookDeliveries.eventType,
        merchant: merchants.businessName,
        paymentId: merchantWebhookDeliveries.paymentId,
        paymentReference: payments.reference,
        status: merchantWebhookDeliveries.status,
        attemptCount: merchantWebhookDeliveries.attemptCount,
        lastStatusCode: merchantWebhookDeliveries.lastStatusCode,
        lastError: merchantWebhookDeliveries.lastError,
        nextAttemptAt: merchantWebhookDeliveries.nextAttemptAt,
        deliveredAt: merchantWebhookDeliveries.deliveredAt,
        createdAt: merchantWebhookDeliveries.createdAt,
      })
      .from(merchantWebhookDeliveries)
      .innerJoin(merchants, eq(merchantWebhookDeliveries.merchantId, merchants.id))
      .innerJoin(payments, eq(merchantWebhookDeliveries.paymentId, payments.id))
      .where(where.length ? and(...where) : undefined)
      .orderBy(desc(merchantWebhookDeliveries.createdAt))
      .limit(200);
  }

  /** Sends a delivery that gave up again, with a fresh retry budget. Same event id, so the merchant can dedupe. */
  @Post('webhooks/:id/retry')
  @HttpCode(200)
  async retryWebhook(@CurrentUser() admin: SessionUser, @Param('id') id: string, @Ip() ip: string) {
    const updated = await this.db
      .update(merchantWebhookDeliveries)
      .set({ status: 'PENDING', nextAttemptAt: null })
      .where(and(eq(merchantWebhookDeliveries.id, id), eq(merchantWebhookDeliveries.status, 'FAILED')))
      .returning({ id: merchantWebhookDeliveries.id });
    if (!updated.length) throw new ConflictException('Only a delivery that failed can be retried');
    await this.queues.enqueueWebhook(id, { jobId: `${id}-retry-${Date.now()}` });
    await this.audit.record({ actorId: admin.id, actorRole: admin.role, action: 'webhook.retried', entityType: 'WebhookDelivery', entityId: id, ipAddress: ip });
    return { id, status: 'PENDING' };
  }

  // ---------- Blockchain ----------

  @Get('blockchain')
  async blockchain(@Query('status') status?: string) {
    const where: SQL[] = [];
    if (status && ['QUEUED', 'SUBMITTED', 'CONFIRMED', 'FAILED'].includes(status)) where.push(eq(blockchainTransactions.status, status as 'FAILED'));
    const [state, byType, txs, mintFailed, redeemFailed] = await Promise.all([
      this.chain.status(),
      this.db
        .select({ type: blockchainTransactions.type, status: blockchainTransactions.status, n: count() })
        .from(blockchainTransactions)
        .groupBy(blockchainTransactions.type, blockchainTransactions.status),
      this.db
        .select({
          id: blockchainTransactions.id,
          type: blockchainTransactions.type,
          status: blockchainTransactions.status,
          ticketId: blockchainTransactions.ticketId,
          tokenId: tickets.tokenId,
          event: events.title,
          txHash: blockchainTransactions.txHash,
          blockNumber: blockchainTransactions.blockNumber,
          errorMessage: blockchainTransactions.errorMessage,
          createdAt: blockchainTransactions.createdAt,
        })
        .from(blockchainTransactions)
        .leftJoin(tickets, eq(blockchainTransactions.ticketId, tickets.id))
        .leftJoin(events, eq(blockchainTransactions.eventId, events.id))
        .where(where.length ? and(...where) : undefined)
        .orderBy(desc(blockchainTransactions.createdAt))
        .limit(200),
      this.db
        .select({ id: tickets.id, event: events.title, seq: tickets.seq, createdAt: tickets.createdAt })
        .from(tickets)
        .innerJoin(events, eq(tickets.eventId, events.id))
        .where(and(eq(tickets.mintStatus, 'FAILED'), inArray(tickets.status, ['ACTIVE', 'REDEEMED'])))
        .limit(100),
      this.db
        .select({ ticketId: ticketRedemptions.ticketId, event: events.title, chainError: ticketRedemptions.chainError, redeemedAt: ticketRedemptions.redeemedAt })
        .from(ticketRedemptions)
        .innerJoin(events, eq(ticketRedemptions.eventId, events.id))
        .where(eq(ticketRedemptions.chainStatus, 'FAILED'))
        .limit(100),
    ]);
    return {
      status: state,
      counts: byType.map((r) => ({ ...r, n: Number(r.n) })),
      transactions: txs.map((t) => ({ ...t, txUrl: t.txHash ? this.chain.config.explorerTxUrl(t.txHash) : null })),
      failedMints: mintFailed,
      failedRedeems: redeemFailed,
    };
  }

  /** Queues a mint, redeem or cancel again. Each job re-checks the chain first, so a retry never duplicates. */
  @Post('blockchain/tickets/:ticketId/retry')
  @HttpCode(200)
  async retryChain(@CurrentUser() admin: SessionUser, @Param('ticketId') ticketId: string, @Body() body: { action?: string }, @Ip() ip: string) {
    if (!this.chain.config.enabled) throw new ConflictException('The blockchain is off in this environment (CHAIN_MODE=disabled)');
    const [t] = await this.db.select({ status: tickets.status, mintStatus: tickets.mintStatus }).from(tickets).where(eq(tickets.id, ticketId));
    if (!t) throw new NotFoundException('Ticket not found');
    const action = body?.action;
    if (action === 'mint') {
      if (t.mintStatus === 'MINTED') throw new ConflictException('This ticket is already minted');
      if (t.status === 'CANCELLED') throw new ConflictException('A cancelled ticket is not minted');
      await this.db.update(tickets).set({ mintStatus: 'PENDING' }).where(and(eq(tickets.id, ticketId), eq(tickets.mintStatus, 'FAILED')));
      await this.queues.enqueueMint(ticketId);
    } else if (action === 'redeem') {
      const [r] = await this.db.select({ chainStatus: ticketRedemptions.chainStatus }).from(ticketRedemptions).where(eq(ticketRedemptions.ticketId, ticketId));
      if (!r) throw new ConflictException('This ticket was not admitted at a gate');
      if (r.chainStatus === 'CONFIRMED') throw new ConflictException('The redeem is already confirmed on-chain');
      await this.db.update(ticketRedemptions).set({ chainStatus: 'PENDING', chainError: null }).where(eq(ticketRedemptions.ticketId, ticketId));
      await this.queues.enqueueRedeem(ticketId);
    } else if (action === 'cancel') {
      if (t.status !== 'CANCELLED') throw new ConflictException('Only a refunded or cancelled ticket is cancelled on-chain');
      await this.queues.enqueueCancel(ticketId);
    } else {
      throw new BadRequestException('action must be mint, redeem or cancel');
    }
    await this.audit.record({ actorId: admin.id, actorRole: admin.role, action: `chain.retry_${action}`, entityType: 'Ticket', entityId: ticketId, ipAddress: ip });
    return { ticketId, queued: action };
  }

  // ---------- Gate staff ----------

  @Get('gate-staff')
  async gateStaff() {
    const staff = await this.db
      .select({ id: users.id, fullName: users.fullName, email: users.email, createdAt: users.createdAt })
      .from(users)
      .where(and(eq(users.role, 'GATE_STAFF'), isNull(users.deletedAt)))
      .orderBy(asc(users.fullName));
    const perms = staff.length
      ? await this.db
          .select({ gateStaffId: gateEventPermissions.gateStaffId, eventId: events.id, title: events.title, startAt: events.startAt })
          .from(gateEventPermissions)
          .innerJoin(events, eq(gateEventPermissions.eventId, events.id))
          .where(inArray(gateEventPermissions.gateStaffId, staff.map((s) => s.id)))
          .orderBy(asc(events.startAt))
      : [];
    const admissions = staff.length
      ? await this.db
          .select({ gateStaffId: ticketRedemptions.gateStaffId, n: count() })
          .from(ticketRedemptions)
          .where(inArray(ticketRedemptions.gateStaffId, staff.map((s) => s.id)))
          .groupBy(ticketRedemptions.gateStaffId)
      : [];
    const admitted = new Map(admissions.map((a) => [a.gateStaffId, Number(a.n)]));
    return staff.map((s) => ({ ...s, events: perms.filter((p) => p.gateStaffId === s.id).map(({ gateStaffId: _, ...e }) => e), admissions: admitted.get(s.id) ?? 0 }));
  }

  @Post('gate-staff')
  async createGateStaff(@CurrentUser() admin: SessionUser, @Body(new ZodPipe(createGateStaffSchema)) body: CreateGateStaffInput, @Ip() ip: string) {
    const passwordHash = await argon2.hash(body.password, { type: argon2.argon2id });
    try {
      const [u] = await this.db.insert(users).values({ email: body.email, fullName: body.fullName, passwordHash, role: 'GATE_STAFF' }).returning({ id: users.id });
      await this.audit.record({ actorId: admin.id, actorRole: admin.role, action: 'gate_staff.created', entityType: 'User', entityId: u.id, metadata: { email: body.email }, ipAddress: ip });
      return { id: u.id, fullName: body.fullName, email: body.email };
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictException('An account with this email already exists');
      throw err;
    }
  }

  @Post('gate-staff/:id/events')
  async assign(@CurrentUser() admin: SessionUser, @Param('id') staffId: string, @Body(new ZodPipe(gateAssignmentSchema)) body: { eventId: string }, @Ip() ip: string) {
    const [staff] = await this.db.select({ id: users.id }).from(users).where(and(eq(users.id, staffId), eq(users.role, 'GATE_STAFF'), isNull(users.deletedAt)));
    if (!staff) throw new NotFoundException('Gate staff account not found');
    const [ev] = await this.db.select({ id: events.id }).from(events).where(and(eq(events.id, body.eventId), isNull(events.deletedAt)));
    if (!ev) throw new NotFoundException('Event not found');
    const [existing] = await this.db
      .select({ id: gateEventPermissions.id })
      .from(gateEventPermissions)
      .where(and(eq(gateEventPermissions.gateStaffId, staffId), eq(gateEventPermissions.eventId, body.eventId)));
    if (!existing) {
      await this.db.insert(gateEventPermissions).values({ gateStaffId: staffId, eventId: body.eventId, grantedById: admin.id });
      await this.audit.record({ actorId: admin.id, actorRole: admin.role, action: 'gate_staff.assigned', entityType: 'User', entityId: staffId, metadata: { eventId: body.eventId }, ipAddress: ip });
    }
    return this.gateStaff();
  }

  @Delete('gate-staff/:id/events/:eventId')
  async unassign(@CurrentUser() admin: SessionUser, @Param('id') staffId: string, @Param('eventId') eventId: string, @Ip() ip: string) {
    const removed = await this.db
      .delete(gateEventPermissions)
      .where(and(eq(gateEventPermissions.gateStaffId, staffId), eq(gateEventPermissions.eventId, eventId)))
      .returning({ id: gateEventPermissions.id });
    if (removed.length) {
      await this.audit.record({ actorId: admin.id, actorRole: admin.role, action: 'gate_staff.unassigned', entityType: 'User', entityId: staffId, metadata: { eventId }, ipAddress: ip });
    }
    return this.gateStaff();
  }

  // ---------- Audit log ----------

  @Get('audit-logs')
  async auditLog(
    @Query('action') action?: string,
    @Query('entityType') entityType?: string,
    @Query('actorRole') actorRole?: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page = 1,
  ) {
    const where: SQL[] = [];
    if (action?.trim()) where.push(ilike(auditLogs.action, `${action.trim().replace(/[%_\\]/g, (c) => `\\${c}`)}%`));
    if (entityType?.trim()) where.push(eq(auditLogs.entityType, entityType.trim()));
    if (actorRole?.trim()) where.push(eq(auditLogs.actorRole, actorRole.trim()));
    const size = 50;
    const p = Math.max(1, Math.min(page, 1000));
    const actor = aliasedTable(users, 'actor');
    const [rows, [{ total }], types] = await Promise.all([
      this.db
        .select({
          id: auditLogs.id,
          action: auditLogs.action,
          actorRole: auditLogs.actorRole,
          actor: actor.fullName,
          actorEmail: actor.email,
          entityType: auditLogs.entityType,
          entityId: auditLogs.entityId,
          metadata: auditLogs.metadata,
          ipAddress: auditLogs.ipAddress,
          createdAt: auditLogs.createdAt,
        })
        .from(auditLogs)
        .leftJoin(actor, eq(auditLogs.actorId, actor.id))
        .where(where.length ? and(...where) : undefined)
        .orderBy(desc(auditLogs.createdAt))
        .limit(size)
        .offset((p - 1) * size),
      this.db.select({ total: count() }).from(auditLogs).where(where.length ? and(...where) : undefined),
      this.db.selectDistinct({ entityType: auditLogs.entityType }).from(auditLogs).orderBy(asc(auditLogs.entityType)),
    ]);
    return { rows, page: p, pageSize: size, total: Number(total), entityTypes: types.map((t) => t.entityType) };
  }
}

/**
 * POST /v1/payments/:id/refund, as named in the proposal. Administrators only; simulated (sandbox),
 * no money moves and the provider is not called.
 */
@Roles('ADMIN')
@Controller('v1/payments')
export class RefundController {
  constructor(private readonly payments: PaymentsService) {}

  @Post(':id/refund')
  @HttpCode(200)
  refund(@CurrentUser() admin: SessionUser, @Param('id') id: string, @Body(new ZodPipe(refundSchema)) body: RefundInput, @Ip() ip: string) {
    return this.payments.refundSimulated(id, admin, body.reason, ip);
  }
}
