import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, Inject, NotFoundException, Param, Post, Put, Query } from '@nestjs/common';
import {
  encryptSecret,
  events,
  generateApiKey,
  generateWebhookSecret,
  ledgerEntries,
  merchantApiKeys,
  merchantWebhookDeliveries,
  merchants,
  orders,
  payments,
  users,
} from '@ticketpay/database';
import type { SessionUser } from '@ticketpay/shared';
import * as argon2 from 'argon2';
import { and, desc, eq, isNull, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { isUniqueViolation } from '../common/db-errors';
import { CurrentUser, Roles } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { DB, type Database } from '../db/db.module';

/** http(s) only. Plain http is allowed only for localhost in development. */
export function validateWebhookUrl(url: string, env: Env): string {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new BadRequestException('Webhook URL is not a valid URL');
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
  if (u.protocol === 'https:' || (u.protocol === 'http:' && local && env.NODE_ENV !== 'production')) return u.toString();
  throw new BadRequestException('Webhook URL must use https (http is allowed only for localhost in development)');
}

const webhookSchema = z.object({ url: z.string().trim().max(500).nullable() });

/**
 * Merchant integration settings and finance reads. The merchant id always comes from the session.
 * Secrets are returned once, at creation or rotation, and never again.
 */
@Roles('ORGANIZER')
@Controller('v1/organizer')
export class MerchantSettingsController {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
    private readonly audit: AuditService,
  ) {}

  private merchantId(user: SessionUser): string {
    if (!user.merchant) throw new ForbiddenException('This account has no merchant profile');
    return user.merchant.id;
  }

  private approvedMerchantId(user: SessionUser): string {
    const id = this.merchantId(user);
    if (user.merchant!.status !== 'APPROVED') throw new ForbiddenException('Your merchant account must be approved first');
    return id;
  }

  @Get('api-keys')
  listKeys(@CurrentUser() user: SessionUser) {
    return this.db
      .select({ id: merchantApiKeys.id, keyPrefix: merchantApiKeys.keyPrefix, lastFour: merchantApiKeys.lastFour, createdAt: merchantApiKeys.createdAt, revokedAt: merchantApiKeys.revokedAt })
      .from(merchantApiKeys)
      .where(eq(merchantApiKeys.merchantId, this.merchantId(user)))
      .orderBy(desc(merchantApiKeys.createdAt));
  }

  @Post('api-keys')
  async createKey(@CurrentUser() user: SessionUser) {
    const merchantId = this.approvedMerchantId(user);
    const k = generateApiKey();
    const [row] = await this.db
      .insert(merchantApiKeys)
      .values({ merchantId, keyPrefix: k.prefix, keyHash: k.hash, lastFour: k.lastFour })
      .returning({ id: merchantApiKeys.id });
    await this.audit.record({ actorId: user.id, actorRole: user.role, action: 'api_key.created', entityType: 'MerchantApiKey', entityId: row.id, metadata: { keyPrefix: k.prefix } });
    return { id: row.id, apiKey: k.key, notice: 'Copy this key now. It will not be shown again.' };
  }

  @Delete('api-keys/:id')
  async revokeKey(@CurrentUser() user: SessionUser, @Param('id') id: string) {
    const [row] = await this.db
      .update(merchantApiKeys)
      .set({ revokedAt: new Date() })
      .where(and(eq(merchantApiKeys.id, id), eq(merchantApiKeys.merchantId, this.merchantId(user)), isNull(merchantApiKeys.revokedAt)))
      .returning({ id: merchantApiKeys.id });
    if (!row) throw new NotFoundException('API key not found');
    await this.audit.record({ actorId: user.id, actorRole: user.role, action: 'api_key.revoked', entityType: 'MerchantApiKey', entityId: id });
    return { ok: true };
  }

  @Put('webhook')
  async setWebhook(@CurrentUser() user: SessionUser, @Body(new ZodPipe(webhookSchema)) body: z.infer<typeof webhookSchema>) {
    const merchantId = this.merchantId(user);
    const url = body.url ? validateWebhookUrl(body.url, this.env) : null;
    const [m] = await this.db.select({ secretEnc: merchants.webhookSecretEnc }).from(merchants).where(eq(merchants.id, merchantId));
    // The first time a URL is set, a secret is created and returned once.
    const secret = url && !m.secretEnc ? generateWebhookSecret() : null;
    await this.db
      .update(merchants)
      .set({ webhookUrl: url, ...(secret ? { webhookSecretEnc: encryptSecret(secret, this.env.WEBHOOK_SECRET_ENC_KEY) } : {}) })
      .where(eq(merchants.id, merchantId));
    await this.audit.record({ actorId: user.id, actorRole: user.role, action: 'merchant.webhook_updated', entityType: 'Merchant', entityId: merchantId, metadata: { url } });
    return { url, ...(secret ? { webhookSecret: secret, notice: 'Copy this secret now. It will not be shown again.' } : {}) };
  }

  @Post('webhook-secret/rotate')
  async rotateSecret(@CurrentUser() user: SessionUser) {
    const merchantId = this.merchantId(user);
    const secret = generateWebhookSecret();
    await this.db.update(merchants).set({ webhookSecretEnc: encryptSecret(secret, this.env.WEBHOOK_SECRET_ENC_KEY) }).where(eq(merchants.id, merchantId));
    await this.audit.record({ actorId: user.id, actorRole: user.role, action: 'merchant.webhook_secret_rotated', entityType: 'Merchant', entityId: merchantId });
    return { webhookSecret: secret, notice: 'Copy this secret now. It will not be shown again. Deliveries from now on are signed with it.' };
  }

  /** Section 6.4: one row per order, with provider and internal status and ticket issuance. */
  @Get('transactions')
  transactions(@CurrentUser() user: SessionUser, @Query('status') status?: string, @Query('eventId') eventId?: string) {
    const filters: SQL[] = [eq(orders.merchantId, this.merchantId(user))];
    if (status && ['PENDING', 'PAID', 'FAILED', 'EXPIRED', 'REFUNDED'].includes(status)) filters.push(eq(orders.status, status as 'PAID'));
    if (eventId) filters.push(eq(orders.eventId, eventId));
    return this.db
      .select({
        orderId: orders.id,
        orderNumber: orders.orderNumber,
        buyerName: orders.buyerName,
        eventId: orders.eventId,
        event: events.title,
        ticketTypes: sql<string>`(select string_agg(tt.name || ' × ' || oi.quantity, ', ' order by tt.tier_code) from order_items oi join ticket_tiers tt on tt.id = oi.tier_id where oi.order_id = ${orders.id})`,
        quantity: sql<number>`(select coalesce(sum(oi.quantity), 0) from order_items oi where oi.order_id = ${orders.id})`.mapWith(Number),
        subtotal: orders.subtotal,
        serviceFee: orders.serviceFee,
        total: orders.total,
        orderStatus: orders.status,
        paymentId: payments.id,
        paymentReference: payments.reference,
        paymentStatus: payments.status,
        provider: payments.provider,
        providerStatus: payments.providerStatus,
        method: payments.method,
        paidAt: payments.paidAt,
        ticketsIssued: sql<number>`(select count(*) from tickets t where t.order_id = ${orders.id})`.mapWith(Number),
        ticketsMinted: sql<number>`(select count(*) from tickets t where t.order_id = ${orders.id} and t.mint_status = 'MINTED')`.mapWith(Number),
        createdAt: orders.createdAt,
      })
      .from(orders)
      .innerJoin(events, eq(orders.eventId, events.id))
      .leftJoin(payments, eq(payments.orderId, orders.id))
      .where(and(...filters))
      .orderBy(desc(orders.createdAt))
      .limit(200);
  }

  @Get('ledger')
  ledger(@CurrentUser() user: SessionUser) {
    return this.db
      .select({
        id: ledgerEntries.id,
        paymentId: ledgerEntries.paymentId,
        paymentReference: payments.reference,
        type: ledgerEntries.type,
        direction: ledgerEntries.direction,
        amount: ledgerEntries.amount,
        description: ledgerEntries.description,
        createdAt: ledgerEntries.createdAt,
      })
      .from(ledgerEntries)
      .innerJoin(payments, eq(ledgerEntries.paymentId, payments.id))
      .where(eq(ledgerEntries.merchantId, this.merchantId(user)))
      .orderBy(desc(ledgerEntries.createdAt))
      .limit(500);
  }

  @Get('webhook-deliveries')
  deliveries(@CurrentUser() user: SessionUser) {
    return this.db
      .select({
        id: merchantWebhookDeliveries.id,
        eventId: merchantWebhookDeliveries.eventId,
        eventType: merchantWebhookDeliveries.eventType,
        status: merchantWebhookDeliveries.status,
        attemptCount: merchantWebhookDeliveries.attemptCount,
        lastStatusCode: merchantWebhookDeliveries.lastStatusCode,
        lastError: merchantWebhookDeliveries.lastError,
        nextAttemptAt: merchantWebhookDeliveries.nextAttemptAt,
        deliveredAt: merchantWebhookDeliveries.deliveredAt,
        createdAt: merchantWebhookDeliveries.createdAt,
      })
      .from(merchantWebhookDeliveries)
      .where(eq(merchantWebhookDeliveries.merchantId, this.merchantId(user)))
      .orderBy(desc(merchantWebhookDeliveries.createdAt))
      .limit(200);
  }
}

const createMerchantSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8).max(128),
  fullName: z.string().trim().min(2).max(120),
  businessName: z.string().trim().min(2).max(160),
  organizerType: z.string().trim().min(2).max(80),
  contactPerson: z.string().trim().min(2).max(120),
  phone: z.string().trim().min(8).max(20),
  address: z.string().trim().min(5).max(300),
  webhookUrl: z.string().trim().max(500).optional(),
});

/** POST /v1/merchants: an administrator onboards an approved sub-merchant and gets its first API key, once. */
@Roles('ADMIN')
@Controller('v1/merchants')
export class MerchantsController {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
    private readonly audit: AuditService,
  ) {}

  @Post()
  async create(@CurrentUser() admin: SessionUser, @Body(new ZodPipe(createMerchantSchema)) body: z.infer<typeof createMerchantSchema>) {
    const passwordHash = await argon2.hash(body.password, { type: argon2.argon2id });
    const webhookUrl = body.webhookUrl ? validateWebhookUrl(body.webhookUrl, this.env) : null;
    const webhookSecret = generateWebhookSecret();
    const key = generateApiKey();
    try {
      const merchantId = await this.db.transaction(async (tx) => {
        const [u] = await tx.insert(users).values({ email: body.email, fullName: body.fullName, phone: body.phone, passwordHash, role: 'ORGANIZER' }).returning({ id: users.id });
        const [m] = await tx
          .insert(merchants)
          .values({
            userId: u.id,
            businessName: body.businessName,
            organizerType: body.organizerType,
            contactPerson: body.contactPerson,
            phone: body.phone,
            address: body.address,
            status: 'APPROVED',
            webhookUrl,
            webhookSecretEnc: encryptSecret(webhookSecret, this.env.WEBHOOK_SECRET_ENC_KEY),
          })
          .returning({ id: merchants.id });
        await tx.insert(merchantApiKeys).values({ merchantId: m.id, keyPrefix: key.prefix, keyHash: key.hash, lastFour: key.lastFour });
        return m.id;
      });
      await this.audit.record({ actorId: admin.id, actorRole: admin.role, action: 'merchant.created', entityType: 'Merchant', entityId: merchantId });
      return { merchantId, status: 'APPROVED', apiKey: key.key, webhookSecret, notice: 'Copy the API key and webhook secret now. They will not be shown again.' };
    } catch (err) {
      if (isUniqueViolation(err)) throw new BadRequestException('An account with this email already exists');
      throw err;
    }
  }
}
