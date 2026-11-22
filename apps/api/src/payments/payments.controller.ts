import { BadRequestException, Body, Controller, Get, Headers, Inject, Param, Post, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { createPaymentSchema, PAYMENT_METHOD_LABEL, type CreatePaymentInput } from '@ticketpay/shared';
import type { Request, Response } from 'express';
import { AuditService } from '../audit/audit.service';
import { Public } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { PaymentActorResolver } from './payment-actor';
import { PaymentsService } from './payments.service';

/**
 * Payment Facilitator API. Callers authenticate inside the handler (session or merchant API key),
 * so the routes are @Public() to the global session guard.
 */
@Controller('v1/payments')
export class PaymentsController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly actors: PaymentActorResolver,
    private readonly audit: AuditService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Methods checkout may show. Only what the configured provider actually offers. */
  @Public()
  @Get('methods')
  methods() {
    return {
      provider: this.payments.provider.kind,
      mode: this.payments.provider.kind === 'MOCK' ? 'mock' : 'sandbox',
      methods: this.payments.provider.methods().map((m) => ({ id: m, ...PAYMENT_METHOD_LABEL[m] })),
    };
  }

  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post()
  async create(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body(new ZodPipe(createPaymentSchema)) body: CreatePaymentInput,
  ) {
    if (!idempotencyKey || idempotencyKey.length < 8 || idempotencyKey.length > 100) {
      throw new BadRequestException('Idempotency-Key header is required (8 to 100 characters)');
    }
    const actor = await this.actors.resolve(req);
    const { payment, replayed } = await this.payments.create(actor, body, idempotencyKey);
    res.status(replayed ? 200 : 201);
    if (replayed) res.setHeader('Idempotent-Replayed', 'true');
    if (!replayed) {
      await this.audit.record({
        actorId: actor.kind === 'buyer' ? actor.user.id : null,
        actorRole: actor.kind === 'buyer' ? 'BUYER' : 'MERCHANT_API',
        action: 'payment.created',
        entityType: 'Payment',
        entityId: payment.id,
        metadata: { method: payment.method, provider: payment.provider, amount: payment.amount },
      });
    }
    return payment;
  }

  @Public()
  @Get(':id')
  async get(@Req() req: Request, @Param('id') id: string) {
    return this.payments.get(await this.actors.resolve(req), id);
  }
}
