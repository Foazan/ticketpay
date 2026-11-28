import { Body, Controller, Get, HttpCode, Inject, Ip, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { events, gateEventPermissions, ticketRedemptions, tickets } from '@ticketpay/database';
import { gateCheckSchema, type GateCheckInput, type GateResult, type SessionUser } from '@ticketpay/shared';
import { and, asc, count, eq, inArray, isNull } from 'drizzle-orm';
import { CurrentUser, Roles } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { DB, type Database } from '../db/db.module';
import { GateService } from './gate.service';

/**
 * Gate staff: validate and admit. These routes can read a ticket and mark it redeemed, nothing else.
 * Gate staff have no route that touches payments, orders or ticket issuance (T22).
 */
@Roles('GATE_STAFF')
@Controller('v1/gate')
export class GateController {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly gate: GateService,
  ) {}

  /** Events this gate staff account has been authorised for by an administrator, with admission counts. */
  @Get('events')
  async events(@CurrentUser() user: SessionUser) {
    const rows = await this.db
      .select({ id: events.id, title: events.title, slug: events.slug, city: events.city, venue: events.venue, startAt: events.startAt, endAt: events.endAt, requiresIdCheck: events.requiresIdCheck })
      .from(gateEventPermissions)
      .innerJoin(events, eq(gateEventPermissions.eventId, events.id))
      .where(and(eq(gateEventPermissions.gateStaffId, user.id), isNull(events.deletedAt)))
      .orderBy(asc(events.startAt));
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    const issued = await this.db
      .select({ eventId: tickets.eventId, n: count() })
      .from(tickets)
      .where(and(inArray(tickets.eventId, ids), inArray(tickets.status, ['ACTIVE', 'REDEEMED'])))
      .groupBy(tickets.eventId);
    const admitted = await this.db
      .select({ eventId: ticketRedemptions.eventId, n: count() })
      .from(ticketRedemptions)
      .where(inArray(ticketRedemptions.eventId, ids))
      .groupBy(ticketRedemptions.eventId);
    const by = (list: { eventId: string; n: number }[]) => new Map(list.map((r) => [r.eventId, Number(r.n)]));
    const issuedBy = by(issued);
    const admittedBy = by(admitted);
    return rows.map((r) => ({ ...r, ticketsIssued: issuedBy.get(r.id) ?? 0, admitted: admittedBy.get(r.id) ?? 0 }));
  }

  /** Checks a scanned QR or typed code. Admits no one. */
  @Post('validate')
  @HttpCode(200)
  @Throttle({ default: { limit: 90, ttl: 60_000 } })
  validate(@CurrentUser() user: SessionUser, @Body(new ZodPipe(gateCheckSchema)) body: GateCheckInput): Promise<GateResult> {
    return this.gate.validate(user, body);
  }

  /** Admits the holder: single use, safe against two gates scanning at once. */
  @Post('redeem')
  @HttpCode(200)
  @Throttle({ default: { limit: 90, ttl: 60_000 } })
  redeem(@CurrentUser() user: SessionUser, @Body(new ZodPipe(gateCheckSchema)) body: GateCheckInput, @Ip() ip: string): Promise<GateResult> {
    return this.gate.redeem(user, body, ip);
  }
}
