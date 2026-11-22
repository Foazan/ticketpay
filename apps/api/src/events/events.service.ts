import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { eventCategories, events, merchants, ticketTiers } from '@ticketpay/database';
import type { EventDetail, EventQuery, EventSummary, Paginated } from '@ticketpay/shared';
import { and, asc, desc, eq, gte, ilike, isNull, lte, or, sql, type SQL } from 'drizzle-orm';
import { DB, type Database } from '../db/db.module';

// Lowest tier price and remaining tickets, computed per event from ticket_tiers.
const fromPrice = sql<number | null>`(select min(tt.price) from ticket_tiers tt where tt.event_id = ${events.id})`.mapWith((v) =>
  v === null ? null : Number(v),
);
const ticketsAvailable = sql<number>`(select coalesce(sum(tt.quota - tt.sold_count - tt.held_count), 0) from ticket_tiers tt where tt.event_id = ${events.id})`.mapWith(
  Number,
);

const ticketsSold = sql<number>`(select coalesce(sum(tt.sold_count), 0) from ticket_tiers tt where tt.event_id = ${events.id})`;

const summaryColumns = {
  id: events.id,
  slug: events.slug,
  title: events.title,
  categoryName: eventCategories.name,
  categorySlug: eventCategories.slug,
  city: events.city,
  venue: events.venue,
  startAt: events.startAt,
  endAt: events.endAt,
  posterPath: events.posterPath,
  organizer: merchants.businessName,
  isFeatured: events.isFeatured,
  fromPrice,
  ticketsAvailable,
};

type SummaryRow = {
  id: string;
  slug: string;
  title: string;
  categoryName: string;
  categorySlug: string;
  city: string;
  venue: string;
  startAt: Date;
  endAt: Date;
  posterPath: string;
  organizer: string;
  isFeatured: boolean;
  fromPrice: number | null;
  ticketsAvailable: number;
};

const toSummary = (r: SummaryRow): EventSummary => ({
  id: r.id,
  slug: r.slug,
  title: r.title,
  category: { name: r.categoryName, slug: r.categorySlug },
  city: r.city,
  venue: r.venue,
  startAt: r.startAt.toISOString(),
  endAt: r.endAt.toISOString(),
  posterPath: r.posterPath,
  organizer: r.organizer,
  isFeatured: r.isFeatured,
  fromPrice: r.fromPrice,
  ticketsAvailable: r.ticketsAvailable,
});

@Injectable()
export class EventsService {
  constructor(@Inject(DB) private readonly db: Database) {}

  /** Only published events of approved merchants are visible to the public. */
  private publicFilter(): SQL[] {
    return [eq(events.status, 'PUBLISHED'), isNull(events.deletedAt), eq(merchants.status, 'APPROVED')];
  }

  async list(query: EventQuery): Promise<Paginated<EventSummary>> {
    const where: (SQL | undefined)[] = [...this.publicFilter()];
    if (query.q) {
      const like = `%${query.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      where.push(or(ilike(events.title, like), ilike(events.city, like), ilike(eventCategories.name, like), ilike(events.venue, like)));
    }
    if (query.category) where.push(eq(eventCategories.slug, query.category));
    if (query.city) where.push(ilike(events.city, query.city));
    if (query.dateFrom) where.push(gte(events.startAt, query.dateFrom));
    if (query.dateTo) where.push(lte(events.startAt, query.dateTo));
    if (query.minPrice !== undefined) where.push(sql`${fromPrice} >= ${query.minPrice}`);
    if (query.maxPrice !== undefined) where.push(sql`${fromPrice} <= ${query.maxPrice}`);
    if (query.featured) where.push(eq(events.isFeatured, query.featured === 'true'));
    const condition = and(...where);

    const order = {
      date_asc: [asc(events.startAt)],
      date_desc: [desc(events.startAt)],
      price_asc: [sql`${fromPrice} asc nulls last`, asc(events.startAt)],
      price_desc: [sql`${fromPrice} desc nulls last`, asc(events.startAt)],
      // Most tickets sold first; ties fall back to the soonest event.
      popular: [sql`${ticketsSold} desc`, asc(events.startAt)],
    }[query.sort];

    const base = () =>
      this.db
        .select(summaryColumns)
        .from(events)
        .innerJoin(eventCategories, eq(events.categoryId, eventCategories.id))
        .innerJoin(merchants, eq(events.merchantId, merchants.id));

    const [rows, [{ total }]] = await Promise.all([
      base()
        .where(condition)
        .orderBy(...order)
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize),
      this.db
        .select({ total: sql<number>`count(*)`.mapWith(Number) })
        .from(events)
        .innerJoin(eventCategories, eq(events.categoryId, eventCategories.id))
        .innerJoin(merchants, eq(events.merchantId, merchants.id))
        .where(condition),
    ]);

    return { items: rows.map(toSummary), page: query.page, pageSize: query.pageSize, total };
  }

  async detail(slug: string): Promise<EventDetail> {
    const [row] = await this.db
      .select({ ...summaryColumns, description: events.description, requiresIdCheck: events.requiresIdCheck })
      .from(events)
      .innerJoin(eventCategories, eq(events.categoryId, eventCategories.id))
      .innerJoin(merchants, eq(events.merchantId, merchants.id))
      .where(and(eq(events.slug, slug), ...this.publicFilter()))
      .limit(1);
    if (!row) throw new NotFoundException('Event not found');

    const tiers = await this.db.select().from(ticketTiers).where(eq(ticketTiers.eventId, row.id)).orderBy(asc(ticketTiers.tierCode));
    const now = new Date();
    return {
      ...toSummary(row),
      description: row.description,
      requiresIdCheck: row.requiresIdCheck,
      tiers: tiers.map((t) => {
        const available = Math.max(0, t.quota - t.soldCount - t.heldCount);
        return {
          id: t.id,
          name: t.name,
          price: t.price,
          quota: t.quota,
          available,
          salesStartAt: t.salesStartAt.toISOString(),
          salesEndAt: t.salesEndAt.toISOString(),
          onSale: available > 0 && t.salesStartAt <= now && now <= t.salesEndAt,
        };
      }),
    };
  }

  async categories() {
    return this.db
      .select({ id: eventCategories.id, name: eventCategories.name, slug: eventCategories.slug })
      .from(eventCategories)
      .orderBy(asc(eventCategories.name));
  }

  /** Cities that currently have at least one public event, for the location filter. */
  async cities(): Promise<string[]> {
    const rows = await this.db
      .selectDistinct({ city: events.city })
      .from(events)
      .innerJoin(merchants, eq(events.merchantId, merchants.id))
      .where(and(...this.publicFilter()))
      .orderBy(asc(events.city));
    return rows.map((r) => r.city);
  }
}
