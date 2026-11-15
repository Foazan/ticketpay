import { Controller, Get, Inject, NotFoundException, Param } from '@nestjs/common';
import { events, ticketTiers, tickets } from '@ticketpay/database';
import type { SessionUser } from '@ticketpay/shared';
import { and, desc, eq } from 'drizzle-orm';
import { CurrentUser, Roles } from '../common/decorators';
import { DB, type Database } from '../db/db.module';

const columns = {
  id: tickets.id,
  status: tickets.status,
  mintStatus: tickets.mintStatus,
  tokenId: tickets.tokenId,
  seq: tickets.seq,
  createdAt: tickets.createdAt,
  eventTitle: events.title,
  eventSlug: events.slug,
  eventStartAt: events.startAt,
  eventEndAt: events.endAt,
  venue: events.venue,
  city: events.city,
  posterPath: events.posterPath,
  onChainEventId: events.onChainEventId,
  tierName: ticketTiers.name,
};

/** A buyer's own tickets. Every query filters by the session user id. */
@Roles('BUYER')
@Controller('v1/tickets')
export class TicketsController {
  constructor(@Inject(DB) private readonly db: Database) {}

  @Get()
  list(@CurrentUser() user: SessionUser) {
    return this.db
      .select(columns)
      .from(tickets)
      .innerJoin(events, eq(tickets.eventId, events.id))
      .innerJoin(ticketTiers, eq(tickets.tierId, ticketTiers.id))
      .where(eq(tickets.ownerId, user.id))
      .orderBy(desc(events.startAt));
  }

  @Get(':id')
  async detail(@CurrentUser() user: SessionUser, @Param('id') id: string) {
    const [row] = await this.db
      .select(columns)
      .from(tickets)
      .innerJoin(events, eq(tickets.eventId, events.id))
      .innerJoin(ticketTiers, eq(tickets.tierId, ticketTiers.id))
      .where(and(eq(tickets.id, id), eq(tickets.ownerId, user.id)));
    // Someone else's ticket is reported as missing, so ticket ids cannot be probed.
    if (!row) throw new NotFoundException('Ticket not found');
    return { ...row, holderName: user.fullName };
  }
}
