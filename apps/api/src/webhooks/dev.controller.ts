import { BadRequestException, Body, Controller, ForbiddenException, Get, HttpCode, Inject, NotFoundException, Param, Post, Req } from '@nestjs/common';
import { decryptSecret, merchants, orders, payments } from '@ticketpay/database';
import { WEBHOOK_HEADERS, type SessionUser } from '@ticketpay/shared';
import { and, eq } from 'drizzle-orm';
import type { Request } from 'express';
import { z } from 'zod';
import { SkipCsrf } from '../auth/guards';
import { CurrentUser, Public, Roles } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { DB, type Database } from '../db/db.module';
import { verifyWebhook } from '../merchant-webhooks/signing';
import { PaymentsService } from '../payments/payments.service';

const simulateSchema = z.object({ outcome: z.enum(['paid', 'failed', 'expired']) });
// The mock speaks Midtrans' vocabulary so it exercises the same mapping and state machine.
const MOCK_STATUS = { paid: ['settlement', 'PAID'], failed: ['deny', 'FAILED'], expired: ['expire', 'EXPIRED'] } as const;

export interface ReceivedWebhook {
  receivedAt: string;
  eventId: string | null;
  type: string | null;
  verified: boolean;
  reason?: string;
  duplicate: boolean;
}

/**
 * Development-only routes. Disabled entirely when NODE_ENV=production.
 * - Mock payment outcomes (only when PAYMENT_PROVIDER=mock): clearly labelled demo payments.
 * - A demo merchant webhook receiver that verifies the HMAC exactly as a merchant would.
 */
@Controller('v1/dev')
export class DevController {
  private readonly received: ReceivedWebhook[] = [];
  private readonly seenEventIds = new Set<string>();

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
    private readonly payments: PaymentsService,
  ) {}

  private assertDev() {
    if (this.env.NODE_ENV === 'production') throw new NotFoundException();
  }

  @Roles('BUYER')
  @HttpCode(200)
  @Post('mock-payments/:id/simulate')
  async simulate(@CurrentUser() user: SessionUser, @Param('id') id: string, @Body(new ZodPipe(simulateSchema)) body: z.infer<typeof simulateSchema>) {
    this.assertDev();
    if (this.env.PAYMENT_PROVIDER !== 'mock') throw new ForbiddenException('Mock payments are only available when PAYMENT_PROVIDER=mock');
    const [row] = await this.db
      .select({ reference: payments.reference, provider: payments.provider })
      .from(payments)
      .innerJoin(orders, eq(payments.orderId, orders.id))
      .where(and(eq(payments.id, id), eq(orders.buyerId, user.id)));
    if (!row) throw new NotFoundException('Payment not found');
    if (row.provider !== 'MOCK') throw new BadRequestException('This payment was not created with the mock provider');
    const [providerStatus, target] = MOCK_STATUS[body.outcome];
    const result = await this.payments.applyUpdate({
      provider: 'MOCK',
      source: 'MOCK',
      reference: row.reference,
      providerStatus,
      target,
      dedupeKey: `MOCK:${row.reference}:${providerStatus}`,
      paymentType: 'mock',
      payload: { mock: true, outcome: body.outcome },
    });
    return { mock: true, ...result };
  }

  /** Demo merchant endpoint. Verifies the signature and timestamp, and deduplicates on the event id. */
  @Public()
  @SkipCsrf()
  @HttpCode(200)
  @Post('webhook-receiver')
  async receive(@Req() req: Request & { rawBody?: Buffer }) {
    this.assertDev();
    const raw = req.rawBody?.toString('utf8') ?? '';
    const eventId = (req.headers[WEBHOOK_HEADERS.eventId] as string) ?? null;
    let parsed: { merchant_id?: string; type?: string } = {};
    try {
      parsed = JSON.parse(raw);
    } catch {
      /* rejected below */
    }
    const [m] = parsed.merchant_id
      ? await this.db.select({ secretEnc: merchants.webhookSecretEnc }).from(merchants).where(eq(merchants.id, parsed.merchant_id))
      : [];
    const result = m?.secretEnc
      ? verifyWebhook(
          decryptSecret(m.secretEnc, this.env.WEBHOOK_SECRET_ENC_KEY),
          { timestamp: req.headers[WEBHOOK_HEADERS.timestamp] as string, signature: req.headers[WEBHOOK_HEADERS.signature] as string },
          raw,
        )
      : ({ ok: false, reason: 'bad_signature' } as const);
    const duplicate = result.ok && !!eventId && this.seenEventIds.has(eventId);
    if (result.ok && eventId) this.seenEventIds.add(eventId);
    this.received.unshift({
      receivedAt: new Date().toISOString(),
      eventId,
      type: parsed.type ?? null,
      verified: result.ok,
      reason: result.ok ? undefined : result.reason,
      duplicate,
    });
    this.received.splice(50);
    if (!result.ok) throw new BadRequestException(`Webhook rejected: ${result.reason}`);
    return { ok: true, duplicate };
  }

  /** The last 50 deliveries the demo receiver saw. */
  @Roles('ADMIN', 'ORGANIZER')
  @Get('webhook-receiver')
  list() {
    this.assertDev();
    return this.received;
  }
}
