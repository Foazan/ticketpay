import { Controller, Get, Inject } from '@nestjs/common';
import { events, merchants, orders, payments, users } from '@ticketpay/database';
import { desc, eq, isNull, sql } from 'drizzle-orm';
import { Roles } from '../common/decorators';
import { DB, type Database } from '../db/db.module';

@Roles('ADMIN')
@Controller('v1/admin')
export class AdminController {
  constructor(@Inject(DB) private readonly db: Database) {}

  @Get('overview')
  async overview() {
    const count = sql<number>`count(*)`.mapWith(Number);
    const [merchantRows, eventRows, paymentRows] = await Promise.all([
      this.db.select({ status: merchants.status, total: count }).from(merchants).where(isNull(merchants.deletedAt)).groupBy(merchants.status),
      this.db.select({ status: events.status, total: count }).from(events).where(isNull(events.deletedAt)).groupBy(events.status),
      this.db.select({ status: payments.status, total: count }).from(payments).groupBy(payments.status),
    ]);
    const byStatus = (rows: { status: string; total: number }[]) => Object.fromEntries(rows.map((r) => [r.status, r.total]));
    return { merchants: byStatus(merchantRows), events: byStatus(eventRows), payments: byStatus(paymentRows) };
  }

  @Get('merchants')
  listMerchants() {
    return this.db
      .select({
        id: merchants.id,
        businessName: merchants.businessName,
        organizerType: merchants.organizerType,
        contactPerson: merchants.contactPerson,
        status: merchants.status,
        email: users.email,
        createdAt: merchants.createdAt,
      })
      .from(merchants)
      .innerJoin(users, eq(merchants.userId, users.id))
      .where(isNull(merchants.deletedAt))
      .orderBy(desc(merchants.createdAt));
  }

  @Get('payments')
  listPayments() {
    return this.db
      .select({
        id: payments.id,
        reference: payments.reference,
        orderNumber: orders.orderNumber,
        merchant: merchants.businessName,
        amount: payments.amount,
        status: payments.status,
        providerStatus: payments.providerStatus,
        createdAt: payments.createdAt,
      })
      .from(payments)
      .innerJoin(orders, eq(payments.orderId, orders.id))
      .innerJoin(merchants, eq(payments.merchantId, merchants.id))
      .orderBy(desc(payments.createdAt))
      .limit(100);
  }
}
