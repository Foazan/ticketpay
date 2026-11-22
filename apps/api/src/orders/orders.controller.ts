import { Body, Controller, Get, Param, Post, Query, Res } from '@nestjs/common';
import { createOrderSchema, parseItemsParam, quoteSchema, type CreateOrderInput, type SessionUser } from '@ticketpay/shared';
import type { Response } from 'express';
import { AuditService } from '../audit/audit.service';
import { CurrentUser, Public, Roles } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { OrdersService } from './orders.service';

@Controller('v1')
export class OrdersController {
  constructor(
    private readonly orders: OrdersService,
    private readonly audit: AuditService,
  ) {}

  /** Prices a cart. "items" is "tierId:qty,tierId:qty". Nothing is held. */
  @Public()
  @Get('checkout/quote')
  quote(@Query('event') eventSlug: string, @Query('items') items: string) {
    const input = new ZodPipe(quoteSchema).transform({ eventSlug, items: parseItemsParam(items) });
    return this.orders.quote(input);
  }

  /** Creates a PENDING order and holds its tickets. A repeat with the same checkoutKey returns the same order. */
  @Roles('BUYER')
  @Post('orders')
  async create(
    @CurrentUser() user: SessionUser,
    @Body(new ZodPipe(createOrderSchema)) body: CreateOrderInput,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { id, created } = await this.orders.create(user, body);
    res.status(created ? 201 : 200);
    if (created) await this.audit.record({ actorId: user.id, actorRole: user.role, action: 'order.created', entityType: 'Order', entityId: id });
    return this.orders.view(id, user.id);
  }

  @Roles('BUYER')
  @Get('orders/:id')
  view(@CurrentUser() user: SessionUser, @Param('id') id: string) {
    return this.orders.view(id, user.id);
  }
}
