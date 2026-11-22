import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
  DefaultValuePipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { events, ledgerEntries, merchantApiKeys, merchants, merchantWebhookDeliveries, orderItems, orders, payments, ticketTiers } from '@ticketpay/database';
import {
  POSTER_MAX_BYTES,
  createEventSchema,
  merchantProfileSchema,
  tierSchema,
  updateEventSchema,
  updateTierSchema,
  type CreateEventInput,
  type MerchantProfileInput,
  type SessionUser,
  type TierInput,
  type UpdateEventInput,
  type UpdateTierInput,
} from '@ticketpay/shared';
import { and, asc, count, desc, eq, gte, inArray, isNull, max, sql, type SQL } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { CurrentUser, Roles } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { DB, type Database } from '../db/db.module';
import { ReconciliationService } from '../reconciliation/reconciliation.service';
import { OrganizerEventsService } from './organizer-events.service';

const num = (q: SQL<unknown>) => q.mapWith(Number);
/**
 * The outer event row's id for correlated subqueries. Drizzle leaves columns unqualified in a
 * single-table select, where a bare "id" would silently bind to the subquery's own table.
 */
const EVENT_ID = sql.raw('"events"."id"');
/** Day buckets in the organizers' time zone, so "today" matches what they see. */
const day = (col: unknown) => sql<string>`to_char(${col} at time zone 'Asia/Jakarta', 'YYYY-MM-DD')`;

/**
 * Organizer dashboard. The merchant id always comes from the session, never from the request,
 * so an organizer can only ever read or change their own merchant's rows (T21). Buyers, gate staff
 * and admins are refused by the role guard (T20).
 */
@Roles('ORGANIZER')
@Controller('v1/organizer')
export class OrganizerController {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly eventsService: OrganizerEventsService,
    private readonly recon: ReconciliationService,
    private readonly audit: AuditService,
  ) {}

  private merchantId(user: SessionUser): string {
    if (!user.merchant) throw new ForbiddenException('This account has no merchant profile');
    return user.merchant.id;
  }

  // ---------- Profile ----------

  @Get('merchant')
  async merchant(@CurrentUser() user: SessionUser) {
    const [row] = await this.db
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
        hasWebhookSecret: sql<boolean>`${merchants.webhookSecretEnc} is not null`,
        createdAt: merchants.createdAt,
      })
      .from(merchants)
      .where(eq(merchants.id, this.merchantId(user)));
    return row;
  }

  /** Contact details only. The business name and status are changed by an administrator. */
  @Patch('merchant')
  async updateMerchant(@CurrentUser() user: SessionUser, @Body(new ZodPipe(merchantProfileSchema)) body: MerchantProfileInput) {
    const merchantId = this.merchantId(user);
    await this.db
      .update(merchants)
      .set({ ...body, description: body.description || null, settlementAccountNote: body.settlementAccountNote || null })
      .where(eq(merchants.id, merchantId));
    await this.audit.record({ actorId: user.id, actorRole: user.role, action: 'merchant.profile_updated', entityType: 'Merchant', entityId: merchantId, metadata: { fields: Object.keys(body) } });
    return this.merchant(user);
  }

  /** Integration health for the settings page: keys, webhook and recent delivery results. */
  @Get('integration')
  async integration(@CurrentUser() user: SessionUser) {
    const merchantId = this.merchantId(user);
    const since = new Date(Date.now() - 7 * 24 * 3600 * 1000);
    const [[keys], [m], [deliveries], [last]] = await Promise.all([
      this.db.select({ n: count() }).from(merchantApiKeys).where(and(eq(merchantApiKeys.merchantId, merchantId), isNull(merchantApiKeys.revokedAt))),
      this.db.select({ url: merchants.webhookUrl, secret: sql<boolean>`${merchants.webhookSecretEnc} is not null` }).from(merchants).where(eq(merchants.id, merchantId)),
      this.db
        .select({
          total: count(),
          delivered: num(sql`count(*) filter (where ${merchantWebhookDeliveries.status} = 'DELIVERED')`),
          failed: num(sql`count(*) filter (where ${merchantWebhookDeliveries.status} = 'FAILED')`),
        })
        .from(merchantWebhookDeliveries)
        .where(and(eq(merchantWebhookDeliveries.merchantId, merchantId), gte(merchantWebhookDeliveries.createdAt, since))),
      this.db
        .select({ status: merchantWebhookDeliveries.status, at: max(merchantWebhookDeliveries.createdAt) })
        .from(merchantWebhookDeliveries)
        .where(eq(merchantWebhookDeliveries.merchantId, merchantId))
        .groupBy(merchantWebhookDeliveries.status)
        .orderBy(desc(max(merchantWebhookDeliveries.createdAt)))
        .limit(1),
    ]);
    return {
      activeApiKeys: Number(keys.n),
      webhookConfigured: Boolean(m?.url),
      webhookSecretSet: Boolean(m?.secret),
      deliveriesLast7Days: { total: Number(deliveries.total), delivered: deliveries.delivered, failed: deliveries.failed },
      lastDeliveryStatus: last?.status ?? null,
    };
  }

  // ---------- Overview ----------

  @Get('overview')
  async overview(@CurrentUser() user: SessionUser) {
    const merchantId = this.merchantId(user);
    const [[ev], [sold], [paid], [pending], [balance], recent, daily, upcoming] = await Promise.all([
      this.db
        .select({ total: count(), published: num(sql`count(*) filter (where ${events.status} = 'PUBLISHED')`) })
        .from(events)
        .where(and(eq(events.merchantId, merchantId), isNull(events.deletedAt))),
      this.db
        .select({ tickets: num(sql`coalesce(sum(${ticketTiers.soldCount}), 0)`) })
        .from(ticketTiers)
        .innerJoin(events, eq(ticketTiers.eventId, events.id))
        .where(and(eq(events.merchantId, merchantId), isNull(events.deletedAt))),
      this.db
        .select({ revenue: num(sql`coalesce(sum(${orders.subtotal}), 0)`) })
        .from(orders)
        .where(and(eq(orders.merchantId, merchantId), eq(orders.status, 'PAID'))),
      this.db.select({ total: count() }).from(orders).where(and(eq(orders.merchantId, merchantId), eq(orders.status, 'PENDING'))),
      this.db
        .select({ net: num(sql`coalesce(sum(${ledgerEntries.amount}), 0)`) })
        .from(ledgerEntries)
        .where(and(eq(ledgerEntries.merchantId, merchantId), eq(ledgerEntries.type, 'MERCHANT_NET'))),
      this.db
        .select({
          orderId: orders.id,
          orderNumber: orders.orderNumber,
          buyerName: orders.buyerName,
          event: events.title,
          total: orders.total,
          status: orders.status,
          createdAt: orders.createdAt,
        })
        .from(orders)
        .innerJoin(events, eq(orders.eventId, events.id))
        .where(eq(orders.merchantId, merchantId))
        .orderBy(desc(orders.createdAt))
        .limit(6),
      this.dailySales(merchantId, 30),
      this.db
        .select({
          id: events.id,
          title: events.title,
          startAt: events.startAt,
          status: events.status,
          sold: num(sql`(select coalesce(sum(tt.sold_count), 0) from ticket_tiers tt where tt.event_id = ${EVENT_ID})`),
          quota: num(sql`(select coalesce(sum(tt.quota), 0) from ticket_tiers tt where tt.event_id = ${EVENT_ID})`),
        })
        .from(events)
        .where(and(eq(events.merchantId, merchantId), isNull(events.deletedAt), gte(events.endAt, new Date()), inArray(events.status, ['PUBLISHED', 'DRAFT', 'UNPUBLISHED'])))
        .orderBy(asc(events.startAt))
        .limit(5),
    ]);
    return {
      totalEvents: Number(ev.total),
      publishedEvents: ev.published,
      ticketsSold: sold.tickets,
      totalRevenue: paid.revenue,
      pendingPayments: Number(pending.total),
      // Internal estimate from sandbox payments. Not settled funds.
      estimatedBalance: balance.net,
      recentTransactions: recent,
      dailySales: daily,
      upcomingEvents: upcoming,
    };
  }

  // ---------- Events ----------

  @Get('events')
  listEvents(@CurrentUser() user: SessionUser) {
    return this.db
      .select({
        id: events.id,
        slug: events.slug,
        title: events.title,
        city: events.city,
        venue: events.venue,
        startAt: events.startAt,
        endAt: events.endAt,
        status: events.status,
        posterPath: events.posterPath,
        tierCount: num(sql`(select count(*) from ticket_tiers tt where tt.event_id = ${EVENT_ID})`),
        sold: num(sql`(select coalesce(sum(tt.sold_count), 0) from ticket_tiers tt where tt.event_id = ${EVENT_ID})`),
        quota: num(sql`(select coalesce(sum(tt.quota), 0) from ticket_tiers tt where tt.event_id = ${EVENT_ID})`),
        revenue: num(sql`(select coalesce(sum(o.subtotal), 0) from orders o where o.event_id = ${EVENT_ID} and o.status = 'PAID')`),
      })
      .from(events)
      .where(and(eq(events.merchantId, this.merchantId(user)), isNull(events.deletedAt)))
      .orderBy(desc(events.startAt));
  }

  @Post('events')
  createEvent(@CurrentUser() user: SessionUser, @Body(new ZodPipe(createEventSchema)) body: CreateEventInput) {
    return this.eventsService.create(user, body);
  }

  @Get('events/:id')
  getEvent(@CurrentUser() user: SessionUser, @Param('id') id: string) {
    return this.eventsService.detail(user, id);
  }

  @Patch('events/:id')
  updateEvent(@CurrentUser() user: SessionUser, @Param('id') id: string, @Body(new ZodPipe(updateEventSchema)) body: UpdateEventInput) {
    return this.eventsService.update(user, id, body);
  }

  @Post('events/:id/poster')
  @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  // Size is capped while streaming, before the file is kept in memory in full.
  @UseInterceptors(FileInterceptor('poster', { limits: { fileSize: POSTER_MAX_BYTES, files: 1 } }))
  uploadPoster(@CurrentUser() user: SessionUser, @Param('id') id: string, @UploadedFile() file?: { buffer: Buffer }) {
    return this.eventsService.setPoster(user, id, file?.buffer);
  }

  @Post('events/:id/publish')
  @HttpCode(200)
  publish(@CurrentUser() user: SessionUser, @Param('id') id: string) {
    return this.eventsService.publish(user, id);
  }

  @Post('events/:id/unpublish')
  @HttpCode(200)
  unpublish(@CurrentUser() user: SessionUser, @Param('id') id: string) {
    return this.eventsService.unpublish(user, id);
  }

  @Post('events/:id/archive')
  @HttpCode(200)
  archive(@CurrentUser() user: SessionUser, @Param('id') id: string) {
    return this.eventsService.archive(user, id);
  }

  @Delete('events/:id')
  removeEvent(@CurrentUser() user: SessionUser, @Param('id') id: string) {
    return this.eventsService.remove(user, id);
  }

  @Post('events/:id/tiers')
  addTier(@CurrentUser() user: SessionUser, @Param('id') id: string, @Body(new ZodPipe(tierSchema)) body: TierInput) {
    return this.eventsService.addTier(user, id, body);
  }

  @Patch('events/:id/tiers/:tierId')
  updateTier(@CurrentUser() user: SessionUser, @Param('id') id: string, @Param('tierId') tierId: string, @Body(new ZodPipe(updateTierSchema)) body: UpdateTierInput) {
    return this.eventsService.updateTier(user, id, tierId, body);
  }

  @Delete('events/:id/tiers/:tierId')
  removeTier(@CurrentUser() user: SessionUser, @Param('id') id: string, @Param('tierId') tierId: string) {
    return this.eventsService.removeTier(user, id, tierId);
  }

  // ---------- Sales analytics ----------

  @Get('analytics')
  async analytics(@CurrentUser() user: SessionUser, @Query('days', new DefaultValuePipe(30), ParseIntPipe) daysParam: number) {
    const merchantId = this.merchantId(user);
    const days = Math.min(Math.max(daysParam, 7), 365);
    const [byTier, daily, fees, methods] = await Promise.all([
      this.db
        .select({
          eventId: events.id,
          eventTitle: events.title,
          eventStatus: events.status,
          startAt: events.startAt,
          tierId: ticketTiers.id,
          tierName: ticketTiers.name,
          price: ticketTiers.price,
          quota: ticketTiers.quota,
          sold: ticketTiers.soldCount,
          held: ticketTiers.heldCount,
          revenue: num(
            sql`(select coalesce(sum(oi.quantity * oi.unit_price), 0) from order_items oi join orders o on o.id = oi.order_id where oi.tier_id = ${ticketTiers.id} and o.status = 'PAID')`,
          ),
        })
        .from(ticketTiers)
        .innerJoin(events, eq(ticketTiers.eventId, events.id))
        .where(and(eq(events.merchantId, merchantId), isNull(events.deletedAt)))
        .orderBy(asc(events.startAt), asc(ticketTiers.tierCode)),
      this.dailySales(merchantId, days),
      this.db
        .select({ type: ledgerEntries.type, amount: num(sql`coalesce(sum(${ledgerEntries.amount}), 0)`) })
        .from(ledgerEntries)
        .where(eq(ledgerEntries.merchantId, merchantId))
        .groupBy(ledgerEntries.type),
      this.db
        .select({ method: payments.method, count: count(), amount: num(sql`coalesce(sum(${payments.amount}), 0)`) })
        .from(payments)
        .where(and(eq(payments.merchantId, merchantId), eq(payments.status, 'PAID')))
        .groupBy(payments.method),
    ]);
    const fee = Object.fromEntries(fees.map((f) => [f.type, f.amount]));
    return {
      days,
      byTier,
      daily,
      paymentMethods: methods.map((m) => ({ ...m, count: Number(m.count) })),
      // The provider fee is unknown in the sandbox and is not deducted; organizer net is an estimate.
      feeBreakdown: { gross: fee.GROSS_SALE ?? 0, serviceFee: fee.SERVICE_FEE ?? 0, providerFee: fee.PROVIDER_FEE ?? null, organizerNet: fee.MERCHANT_NET ?? 0 },
    };
  }

  // ---------- Reconciliation ----------

  @Get('reconciliation')
  reconciliation(@CurrentUser() user: SessionUser) {
    return this.recon.report({ merchantId: this.merchantId(user), limit: 300 });
  }

  // ---------- Internals ----------

  /** Paid tickets and ticket revenue for each of the last `days` days in WIB, today included, empty days filled. */
  private async dailySales(merchantId: string, days: number) {
    const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' });
    const today = fmt.format(new Date());
    // Noon UTC on each WIB calendar day: safely inside that day whatever the offset.
    const keys = Array.from({ length: days }, (_, i) => fmt.format(new Date(Date.parse(`${today}T12:00:00Z`) - (days - 1 - i) * 24 * 3600 * 1000)));
    const since = new Date(`${keys[0]}T00:00:00+07:00`);
    const rows = await this.db
      .select({
        date: day(payments.paidAt),
        tickets: num(sql`coalesce(sum((select sum(oi.quantity) from order_items oi where oi.order_id = ${orders.id})), 0)`),
        revenue: num(sql`coalesce(sum(${orders.subtotal}), 0)`),
      })
      .from(payments)
      .innerJoin(orders, eq(payments.orderId, orders.id))
      .where(and(eq(payments.merchantId, merchantId), eq(payments.status, 'PAID'), gte(payments.paidAt, since)))
      .groupBy(day(payments.paidAt));
    const byDate = new Map(rows.map((r) => [r.date, r]));
    return keys.map((date) => byDate.get(date) ?? { date, tickets: 0, revenue: 0 });
  }
}

// Order item columns used in raw SQL above; referenced here so a rename fails to compile.
void orderItems.quantity;
void orderItems.unitPrice;
