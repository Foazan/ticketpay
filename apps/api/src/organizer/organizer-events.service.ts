import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { eventCategories, events, merchants, orderItems, orders, slugify, ticketTiers } from '@ticketpay/database';
import {
  MAX_TIERS_PER_EVENT,
  type CreateEventInput,
  type SessionUser,
  type TierInput,
  type UpdateEventInput,
  type UpdateTierInput,
} from '@ticketpay/shared';
import { and, asc, count, eq, isNull, max, ne, sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { isCheckViolation as isCheck, isUniqueViolation as isUnique } from '../common/db-errors';
import { DB, type Database } from '../db/db.module';
import { MediaService } from '../media/media.service';

type EventRow = typeof events.$inferSelect;


/**
 * Event and ticket category management for an organizer. Every query is scoped by the merchant id
 * from the session; another merchant's event is reported as not found (T21).
 */
@Injectable()
export class OrganizerEventsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly media: MediaService,
    private readonly audit: AuditService,
  ) {}

  merchantId(user: SessionUser): string {
    if (!user.merchant) throw new ForbiddenException('This account has no merchant profile');
    return user.merchant.id;
  }

  async detail(user: SessionUser, id: string) {
    const event = await this.own(user, id);
    const [category] = await this.db.select({ name: eventCategories.name }).from(eventCategories).where(eq(eventCategories.id, event.categoryId));
    const tiers = await this.db.select().from(ticketTiers).where(eq(ticketTiers.eventId, id)).orderBy(asc(ticketTiers.tierCode));
    const [{ n }] = await this.db.select({ n: count() }).from(orders).where(eq(orders.eventId, id));
    return { ...event, categoryName: category?.name ?? '', tiers, orderCount: Number(n), canDelete: Number(n) === 0 };
  }

  async create(user: SessionUser, input: CreateEventInput) {
    const merchantId = this.merchantId(user);
    const category = await this.category(input.categoryId);
    const posterPath = await this.media.saveGeneratedPoster(input.title, category.name);
    const base = slugify(input.title).slice(0, 80) || 'event';
    for (let attempt = 0; attempt < 5; attempt++) {
      const slug = attempt === 0 ? base : `${base}-${Math.random().toString(36).slice(2, 6)}`;
      try {
        const [row] = await this.db
          .insert(events)
          .values({ merchantId, ...input, slug, posterPath, status: 'DRAFT' })
          .returning({ id: events.id });
        await this.audit.record({ actorId: user.id, actorRole: user.role, action: 'event.created', entityType: 'Event', entityId: row.id, metadata: { title: input.title } });
        return this.detail(user, row.id);
      } catch (err) {
        if (!isUnique(err)) throw err;
      }
    }
    throw new ConflictException('Could not pick a unique address for this event. Try a slightly different title.');
  }

  async update(user: SessionUser, id: string, input: UpdateEventInput) {
    const event = await this.own(user, id);
    if (event.status === 'ARCHIVED') throw new ConflictException('An archived event cannot be edited');
    const startAt = input.startAt ?? event.startAt;
    const endAt = input.endAt ?? event.endAt;
    if (endAt <= startAt) throw new BadRequestException('The event must end after it starts');
    if ((input.startAt || input.endAt) && startAt.getTime() <= Date.now()) throw new BadRequestException('The event must start in the future');
    const category = input.categoryId ? await this.category(input.categoryId) : null;
    // A generated poster follows the title and category; an uploaded one is kept.
    let posterPath: string | undefined;
    if ((input.title || category) && this.media.isGenerated(event.posterPath)) {
      const categoryName = category?.name ?? (await this.category(event.categoryId)).name;
      posterPath = await this.media.saveGeneratedPoster(input.title ?? event.title, categoryName);
    }
    await this.db.update(events).set({ ...input, ...(posterPath ? { posterPath } : {}) }).where(eq(events.id, id));
    if (posterPath) await this.media.remove(event.posterPath);
    await this.audit.record({ actorId: user.id, actorRole: user.role, action: 'event.updated', entityType: 'Event', entityId: id, metadata: { fields: Object.keys(input) } });
    return this.detail(user, id);
  }

  async setPoster(user: SessionUser, id: string, file: Buffer | undefined) {
    const event = await this.own(user, id);
    if (!file?.length) throw new BadRequestException('Choose an image to upload');
    const posterPath = await this.media.savePoster(file);
    await this.db.update(events).set({ posterPath }).where(eq(events.id, id));
    await this.media.remove(event.posterPath);
    await this.audit.record({ actorId: user.id, actorRole: user.role, action: 'event.poster_uploaded', entityType: 'Event', entityId: id });
    return this.detail(user, id);
  }

  /** Publishing needs an approved merchant (read fresh, not from the session) and a sellable event. */
  async publish(user: SessionUser, id: string) {
    const merchantId = this.merchantId(user);
    const [m] = await this.db.select({ status: merchants.status }).from(merchants).where(eq(merchants.id, merchantId));
    if (m?.status !== 'APPROVED') throw new ForbiddenException('Your organizer account must be approved by TicketPay before you can publish events');
    const event = await this.own(user, id);
    if (event.status === 'PUBLISHED') return this.detail(user, id);
    if (event.status === 'ARCHIVED') throw new ConflictException('An archived event cannot be published');
    if (event.startAt.getTime() <= Date.now()) throw new ConflictException('This event has already started');
    const tiers = await this.db.select().from(ticketTiers).where(eq(ticketTiers.eventId, id));
    if (!tiers.length) throw new ConflictException('Add at least one ticket category before publishing');
    const late = tiers.find((t) => t.salesEndAt > event.endAt);
    if (late) throw new ConflictException(`Ticket sales for "${late.name}" end after the event ends`);
    await this.setStatus(user, event, 'PUBLISHED');
    return this.detail(user, id);
  }

  /** Hides the event from the marketplace. Tickets already sold stay valid. */
  async unpublish(user: SessionUser, id: string) {
    const event = await this.own(user, id);
    if (event.status !== 'PUBLISHED') throw new ConflictException('Only a published event can be unpublished');
    await this.setStatus(user, event, 'UNPUBLISHED');
    return this.detail(user, id);
  }

  async archive(user: SessionUser, id: string) {
    const event = await this.own(user, id);
    if (event.status === 'PUBLISHED') throw new ConflictException('Unpublish the event before archiving it');
    await this.setStatus(user, event, 'ARCHIVED');
    return this.detail(user, id);
  }

  /** Only an event that never had an order can be deleted; otherwise its records must stay, so archive it. */
  async remove(user: SessionUser, id: string) {
    const event = await this.own(user, id);
    const [{ n }] = await this.db.select({ n: count() }).from(orders).where(eq(orders.eventId, id));
    if (Number(n) > 0) throw new ConflictException('This event has orders, so it cannot be deleted. Unpublish and archive it instead.');
    if (event.status === 'PUBLISHED') throw new ConflictException('Unpublish the event before deleting it');
    await this.db.update(events).set({ deletedAt: new Date() }).where(eq(events.id, id));
    await this.audit.record({ actorId: user.id, actorRole: user.role, action: 'event.deleted', entityType: 'Event', entityId: id });
    return { deleted: true };
  }

  // ---------- Ticket categories ----------

  async addTier(user: SessionUser, eventId: string, input: TierInput) {
    const event = await this.own(user, eventId);
    if (event.status === 'ARCHIVED') throw new ConflictException('An archived event cannot be changed');
    if (input.salesEndAt > event.endAt) throw new BadRequestException('Ticket sales must end before the event ends');
    const [{ n, top }] = await this.db.select({ n: count(), top: max(ticketTiers.tierCode) }).from(ticketTiers).where(eq(ticketTiers.eventId, eventId));
    if (Number(n) >= MAX_TIERS_PER_EVENT) throw new ConflictException(`An event can have at most ${MAX_TIERS_PER_EVENT} ticket categories`);
    try {
      const [tier] = await this.db
        .insert(ticketTiers)
        .values({ eventId, ...input, tierCode: (top ?? 0) + 1 })
        .returning({ id: ticketTiers.id });
      await this.audit.record({ actorId: user.id, actorRole: user.role, action: 'tier.created', entityType: 'TicketTier', entityId: tier.id, metadata: { eventId, ...input } });
    } catch (err) {
      if (isUnique(err)) throw new ConflictException(`This event already has a ticket category named "${input.name}"`);
      throw err;
    }
    return this.detail(user, eventId);
  }

  async updateTier(user: SessionUser, eventId: string, tierId: string, input: UpdateTierInput) {
    const event = await this.own(user, eventId);
    if (event.status === 'ARCHIVED') throw new ConflictException('An archived event cannot be changed');
    const tier = await this.tier(eventId, tierId);
    const salesStartAt = input.salesStartAt ?? tier.salesStartAt;
    const salesEndAt = input.salesEndAt ?? tier.salesEndAt;
    if (salesEndAt <= salesStartAt) throw new BadRequestException('Sales must end after they start');
    if (salesEndAt > event.endAt) throw new BadRequestException('Ticket sales must end before the event ends');
    try {
      // The conditional update and the table's CHECK constraint both refuse a quota below sold + held.
      const updated = await this.db
        .update(ticketTiers)
        .set(input)
        .where(and(eq(ticketTiers.id, tierId), input.quota != null ? sql`${ticketTiers.soldCount} + ${ticketTiers.heldCount} <= ${input.quota}` : sql`true`))
        .returning({ id: ticketTiers.id });
      if (!updated.length) throw new ConflictException(this.quotaMessage(tier));
    } catch (err) {
      if (isCheck(err)) throw new ConflictException(this.quotaMessage(tier));
      if (isUnique(err)) throw new ConflictException(`This event already has a ticket category named "${input.name}"`);
      throw err;
    }
    await this.audit.record({ actorId: user.id, actorRole: user.role, action: 'tier.updated', entityType: 'TicketTier', entityId: tierId, metadata: { eventId, ...input } });
    return this.detail(user, eventId);
  }

  async removeTier(user: SessionUser, eventId: string, tierId: string) {
    await this.own(user, eventId);
    const tier = await this.tier(eventId, tierId);
    const [{ n }] = await this.db.select({ n: count() }).from(orderItems).where(eq(orderItems.tierId, tierId));
    if (Number(n) > 0 || tier.soldCount > 0 || tier.heldCount > 0) {
      throw new ConflictException('This ticket category has orders, so it cannot be removed. Lower its quota or end its sales period instead.');
    }
    await this.db.delete(ticketTiers).where(eq(ticketTiers.id, tierId));
    await this.audit.record({ actorId: user.id, actorRole: user.role, action: 'tier.deleted', entityType: 'TicketTier', entityId: tierId, metadata: { eventId } });
    return this.detail(user, eventId);
  }

  // ---------- Internals ----------

  private quotaMessage(tier: { soldCount: number; heldCount: number }) {
    const taken = tier.soldCount + tier.heldCount;
    return `The quota cannot be lower than the ${taken} tickets already sold or held in checkout`;
  }

  private async own(user: SessionUser, id: string): Promise<EventRow> {
    const [row] = await this.db
      .select()
      .from(events)
      .where(and(eq(events.id, id), eq(events.merchantId, this.merchantId(user)), isNull(events.deletedAt)));
    // Another merchant's event is reported as missing, so its existence is not revealed.
    if (!row) throw new NotFoundException('Event not found');
    return row;
  }

  private async tier(eventId: string, tierId: string) {
    const [tier] = await this.db.select().from(ticketTiers).where(and(eq(ticketTiers.id, tierId), eq(ticketTiers.eventId, eventId)));
    if (!tier) throw new NotFoundException('Ticket category not found');
    return tier;
  }

  private async category(id: string) {
    const [c] = await this.db.select().from(eventCategories).where(eq(eventCategories.id, id));
    if (!c) throw new BadRequestException('Unknown category');
    return c;
  }

  private async setStatus(user: SessionUser, event: EventRow, status: 'PUBLISHED' | 'UNPUBLISHED' | 'ARCHIVED') {
    await this.db.update(events).set({ status }).where(and(eq(events.id, event.id), ne(events.status, status)));
    await this.audit.record({
      actorId: user.id,
      actorRole: user.role,
      action: `event.${status.toLowerCase()}`,
      entityType: 'Event',
      entityId: event.id,
      metadata: { from: event.status },
    });
  }
}
