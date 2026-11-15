import { Controller, Get, Param, Query } from '@nestjs/common';
import { eventQuerySchema, type EventQuery } from '@ticketpay/shared';
import { Public } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { EventsService } from './events.service';

@Public()
@Controller('v1')
export class EventsController {
  constructor(private readonly eventsService: EventsService) {}

  @Get('events')
  list(@Query(new ZodPipe(eventQuerySchema)) query: EventQuery) {
    return this.eventsService.list(query);
  }

  @Get('events/:slug')
  detail(@Param('slug') slug: string) {
    return this.eventsService.detail(slug);
  }

  @Get('categories')
  categories() {
    return this.eventsService.categories();
  }

  @Get('cities')
  cities() {
    return this.eventsService.cities();
  }
}
