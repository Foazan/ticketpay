import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { events, merchants, orderItems, orders, payments, ticketTiers, tickets } from '@ticketpay/database';
import {
  HOLD_MINUTES,
  computeServiceFee,
  type CreateOrderInput,
  type OrderView,
  type Quote,
  type QuoteInput,
  type QuoteLine,
  type SessionUser,
} from '@ticketpay/shared';
import { and, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import { isUniqueViolation } from '../common/db-errors';
import { newOrderNumber } from '../common/ids';
import { DB, type Database } from '../db/db.module';
import { FeesService } from '../payments/fees.service';

/** A buyer may hold tickets in at most this many unpaid orders at once. */
export const MAX_OPEN_ORDERS_PER_BUYER = 3;

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

@Injectable()
export class OrdersService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly fees: FeesService,
  ) {}

  /** Prices a cart without holding anything. Throws a clear 400 for every reason a purchase would fail. */
  async quote(input: QuoteInput, now = new Date()): Promise<Quote> {
    const [event] = await this.db
      .select({
        id: events.id,
        slug: events.slug,
        title: events.title,
        startAt: events.startAt,
        city: events.city,
        venue: events.venue,
        posterPath: events.posterPath,
        merchantId: events.merchantId,
      })
      .from(events)
      .innerJoin(merchants, eq(events.merchantId, merchants.id))
      .where(and(eq(events.slug, input.eventSlug), eq(events.status, 'PUBLISHED'), isNull(events.deletedAt), eq(merchants.status, 'APPROVED')));
    if (!event) throw new NotFoundException('Event not found or not on sale');

    const tiers = await this.db
      .select()
      .from(ticketTiers)
      .where(and(eq(ticketTiers.eventId, event.id), inArray(ticketTiers.id, input.items.map((i) => i.tierId))));
    const lines: QuoteLine[] = input.items.map((item) => {
      const tier = tiers.find((t) => t.id === item.tierId);
      if (!tier) throw new BadRequestException('A selected ticket category does not belong to this event');
      if (now < tier.salesStartAt) throw new BadRequestException(`Sales for ${tier.name} have not started yet`);
      if (now > tier.salesEndAt) throw new BadRequestException(`Sales for ${tier.name} have closed`);
      const available = tier.quota - tier.soldCount - tier.heldCount;
      if (item.quantity > available) {
        throw new ConflictException(available <= 0 ? `${tier.name} is sold out` : `Only ${available} ${tier.name} tickets are left`);
      }
      return { tierId: tier.id, tierName: tier.name, unitPrice: tier.price, quantity: item.quantity, lineTotal: tier.price * item.quantity };
    });
    const subtotal = lines.reduce((s, l) => s + l.lineTotal, 0);
    const feeRateBps = await this.fees.currentRateBps(now);
    const serviceFee = computeServiceFee(subtotal, feeRateBps);
    return {
      event: {
        id: event.id,
        slug: event.slug,
        title: event.title,
        startAt: event.startAt.toISOString(),
        city: event.city,
        venue: event.venue,
        posterPath: event.posterPath,
      },
      lines,
      subtotal,
      feeRateBps,
      serviceFee,
      total: subtotal + serviceFee,
    };
  }

  /**
   * Creates a PENDING order and holds its tickets for HOLD_MINUTES.
   * Each tier is updated with a conditional increment, so two buyers can never hold the same last ticket;
   * the CHECK constraint on ticket_tiers is a second line of defence.
   */
  async create(user: SessionUser, input: CreateOrderInput, now = new Date()): Promise<{ id: string; created: boolean }> {
    const existing = await this.findByCheckoutKey(user.id, input.checkoutKey);
    if (existing) return { id: existing, created: false };

    const quote = await this.quote(input, now);
    const [{ open }] = await this.db
      .select({ open: sql<number>`count(*)`.mapWith(Number) })
      .from(orders)
      .where(and(eq(orders.buyerId, user.id), eq(orders.status, 'PENDING'), gt(orders.holdExpiresAt, now)));
    if (open >= MAX_OPEN_ORDERS_PER_BUYER) {
      throw new ConflictException('You already have unpaid orders holding tickets. Pay for one or wait for it to expire.');
    }

    const [ev] = await this.db.select({ merchantId: events.merchantId }).from(events).where(eq(events.id, quote.event.id));
    try {
      const id = await this.db.transaction(async (tx) => {
        // Lock tiers in a fixed order to avoid deadlocks between concurrent checkouts.
        for (const line of [...quote.lines].sort((a, b) => a.tierId.localeCompare(b.tierId))) {
          const held = await tx
            .update(ticketTiers)
            .set({ heldCount: sql`${ticketTiers.heldCount} + ${line.quantity}` })
            .where(
              and(
                eq(ticketTiers.id, line.tierId),
                sql`${ticketTiers.soldCount} + ${ticketTiers.heldCount} + ${line.quantity} <= ${ticketTiers.quota}`,
              ),
            )
            .returning({ id: ticketTiers.id });
          if (held.length === 0) throw new ConflictException(`Not enough ${line.tierName} tickets are left`);
        }
        const [order] = await tx
          .insert(orders)
          .values({
            orderNumber: newOrderNumber(now),
            buyerId: user.id,
            eventId: quote.event.id,
            merchantId: ev.merchantId,
            status: 'PENDING',
            subtotal: quote.subtotal,
            serviceFee: quote.serviceFee,
            feeRateBps: quote.feeRateBps,
            total: quote.total,
            buyerName: input.buyerName,
            buyerEmail: input.buyerEmail,
            buyerPhone: input.buyerPhone,
            holdExpiresAt: new Date(now.getTime() + HOLD_MINUTES * 60_000),
            checkoutKey: input.checkoutKey,
          })
          .returning({ id: orders.id });
        await tx.insert(orderItems).values(quote.lines.map((l) => ({ orderId: order.id, tierId: l.tierId, quantity: l.quantity, unitPrice: l.unitPrice })));
        return order.id;
      });
      return { id, created: true };
    } catch (err) {
      // A double click raced past the first lookup: return the order the other request created.
      if (isUniqueViolation(err)) {
        const winner = await this.findByCheckoutKey(user.id, input.checkoutKey);
        if (winner) return { id: winner, created: false };
      }
      throw err;
    }
  }

  private async findByCheckoutKey(buyerId: string, checkoutKey: string): Promise<string | null> {
    const [row] = await this.db
      .select({ id: orders.id })
      .from(orders)
      .where(and(eq(orders.buyerId, buyerId), eq(orders.checkoutKey, checkoutKey)));
    return row?.id ?? null;
  }

  /** Gives held tickets back to the pool. Only call inside the transaction that moves the order out of PENDING. */
  async releaseHold(tx: Tx, orderId: string): Promise<void> {
    const items = await tx.select().from(orderItems).where(eq(orderItems.orderId, orderId));
    for (const item of items) {
      await tx
        .update(ticketTiers)
        .set({ heldCount: sql`${ticketTiers.heldCount} - ${item.quantity}` })
        .where(eq(ticketTiers.id, item.tierId));
    }
  }

  /** Converts held tickets into sold tickets. Only call inside the transaction that marks the order PAID. */
  async convertHoldToSold(tx: Tx, orderId: string): Promise<void> {
    const items = await tx.select().from(orderItems).where(eq(orderItems.orderId, orderId));
    for (const item of items) {
      await tx
        .update(ticketTiers)
        .set({ heldCount: sql`${ticketTiers.heldCount} - ${item.quantity}`, soldCount: sql`${ticketTiers.soldCount} + ${item.quantity}` })
        .where(eq(ticketTiers.id, item.tierId));
    }
  }

  /** An order as its buyer sees it. Another buyer's order is reported as missing. */
  async view(orderId: string, buyerId: string): Promise<OrderView> {
    const [row] = await this.db
      .select({ order: orders, event: { title: events.title, slug: events.slug, startAt: events.startAt, city: events.city, venue: events.venue } })
      .from(orders)
      .innerJoin(events, eq(orders.eventId, events.id))
      .where(and(eq(orders.id, orderId), eq(orders.buyerId, buyerId)));
    if (!row) throw new NotFoundException('Order not found');
    const o = row.order;
    const [items, [payment], issued] = await Promise.all([
      this.db
        .select({ tierId: orderItems.tierId, tierName: ticketTiers.name, unitPrice: orderItems.unitPrice, quantity: orderItems.quantity })
        .from(orderItems)
        .innerJoin(ticketTiers, eq(orderItems.tierId, ticketTiers.id))
        .where(eq(orderItems.orderId, o.id)),
      this.db.select().from(payments).where(eq(payments.orderId, o.id)),
      this.db
        .select({ issued: sql<number>`count(*)`.mapWith(Number), minted: sql<number>`count(*) filter (where ${tickets.mintStatus} = 'MINTED')`.mapWith(Number) })
        .from(tickets)
        .where(eq(tickets.orderId, o.id)),
    ]);
    return {
      id: o.id,
      orderNumber: o.orderNumber,
      status: o.status,
      event: { ...row.event, startAt: row.event.startAt.toISOString() },
      lines: items.map((i) => ({ ...i, lineTotal: i.unitPrice * i.quantity })),
      subtotal: o.subtotal,
      feeRateBps: o.feeRateBps,
      serviceFee: o.serviceFee,
      total: o.total,
      holdExpiresAt: o.holdExpiresAt.toISOString(),
      createdAt: o.createdAt.toISOString(),
      payment: payment
        ? {
            id: payment.id,
            reference: payment.reference,
            status: payment.status,
            method: payment.method,
            provider: payment.provider,
            paymentType: payment.paymentType,
            redirectUrl: payment.redirectUrl,
            paidAt: payment.paidAt?.toISOString() ?? null,
            expiresAt: payment.expiresAt.toISOString(),
          }
        : null,
      tickets: issued[0],
    };
  }
}
