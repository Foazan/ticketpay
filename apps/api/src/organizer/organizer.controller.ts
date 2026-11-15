import { Controller, ForbiddenException, Get, Inject, NotFoundException, Param } from '@nestjs/common';
import { events, ledgerEntries, merchants, orders, ticketTiers } from '@ticketpay/database';
import type { SessionUser } from '@ticketpay/shared';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { CurrentUser, Roles } from '../common/decorators';
import { DB, type Database } from '../db/db.module';

/**
 * Organizer dashboard data. The merchant id always comes from the session, never from the request,
 * so an organizer can only ever read their own merchant's rows.
 */
@Roles('ORGANIZER')
@Controller('v1/organizer')
export class OrganizerController {
  constructor(@Inject(DB) private readonly db: Database) {}

  private merchantId(user: SessionUser): string {
    if (!user.merchant) throw new ForbiddenException('This account has no merchant profile');
    return user.merchant.id;
  }

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
        status: merchants.status,
        statusReason: merchants.statusReason,
        webhookUrl: merchants.webhookUrl,
        createdAt: merchants.createdAt,
      })
      .from(merchants)
      .where(eq(merchants.id, this.merchantId(user)));
    return row;
  }

  @Get('overview')
  async overview(@CurrentUser() user: SessionUser) {
    const merchantId = this.merchantId(user);
    const count = sql<number>`count(*)`.mapWith(Number);
    const [[ev], [sold], [paid], [pending], [balance]] = await Promise.all([
      this.db
        .select({ total: count, published: sql<number>`count(*) filter (where ${events.status} = 'PUBLISHED')`.mapWith(Number) })
        .from(events)
        .where(and(eq(events.merchantId, merchantId), isNull(events.deletedAt))),
      this.db
        .select({ tickets: sql<number>`coalesce(sum(${ticketTiers.soldCount}), 0)`.mapWith(Number) })
        .from(ticketTiers)
        .innerJoin(events, eq(ticketTiers.eventId, events.id))
        .where(eq(events.merchantId, merchantId)),
      this.db
        .select({ revenue: sql<number>`coalesce(sum(${orders.subtotal}), 0)`.mapWith(Number) })
        .from(orders)
        .where(and(eq(orders.merchantId, merchantId), eq(orders.status, 'PAID'))),
      this.db.select({ total: count }).from(orders).where(and(eq(orders.merchantId, merchantId), eq(orders.status, 'PENDING'))),
      this.db
        .select({ net: sql<number>`coalesce(sum(${ledgerEntries.amount}), 0)`.mapWith(Number) })
        .from(ledgerEntries)
        .where(and(eq(ledgerEntries.merchantId, merchantId), eq(ledgerEntries.type, 'MERCHANT_NET'))),
    ]);
    return {
      totalEvents: ev.total,
      publishedEvents: ev.published,
      ticketsSold: sold.tickets,
      totalRevenue: paid.revenue,
      pendingPayments: pending.total,
      // Internal estimate from sandbox payments. Not settled funds.
      estimatedBalance: balance.net,
    };
  }

  @Get('events')
  async listEvents(@CurrentUser() user: SessionUser) {
    return this.db
      .select({ id: events.id, slug: events.slug, title: events.title, city: events.city, startAt: events.startAt, status: events.status })
      .from(events)
      .where(and(eq(events.merchantId, this.merchantId(user)), isNull(events.deletedAt)))
      .orderBy(desc(events.startAt));
  }

  @Get('events/:id')
  async getEvent(@CurrentUser() user: SessionUser, @Param('id') id: string) {
    const [row] = await this.db
      .select()
      .from(events)
      .where(and(eq(events.id, id), eq(events.merchantId, this.merchantId(user)), isNull(events.deletedAt)));
    // Another merchant's event is reported as missing, so its existence is not revealed.
    if (!row) throw new NotFoundException('Event not found');
    const tiers = await this.db.select().from(ticketTiers).where(eq(ticketTiers.eventId, row.id));
    return { ...row, tiers };
  }
}
