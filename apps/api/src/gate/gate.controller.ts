import { Controller, Get, Inject } from '@nestjs/common';
import { events, gateEventPermissions } from '@ticketpay/database';
import type { SessionUser } from '@ticketpay/shared';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { CurrentUser, Roles } from '../common/decorators';
import { DB, type Database } from '../db/db.module';

@Roles('GATE_STAFF')
@Controller('v1/gate')
export class GateController {
  constructor(@Inject(DB) private readonly db: Database) {}

  /** Events this gate staff account has been authorised for by an administrator. */
  @Get('events')
  events(@CurrentUser() user: SessionUser) {
    return this.db
      .select({ id: events.id, title: events.title, city: events.city, venue: events.venue, startAt: events.startAt, endAt: events.endAt })
      .from(gateEventPermissions)
      .innerJoin(events, eq(gateEventPermissions.eventId, events.id))
      .where(and(eq(gateEventPermissions.gateStaffId, user.id), isNull(events.deletedAt)))
      .orderBy(asc(events.startAt));
  }
}
