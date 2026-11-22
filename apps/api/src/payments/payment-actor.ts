import { Injectable, UnauthorizedException, ForbiddenException, Inject } from '@nestjs/common';
import { merchantApiKeys, merchants, safeEqual, sha256Hex } from '@ticketpay/database';
import { and, eq, isNull } from 'drizzle-orm';
import type { Request } from 'express';
import { AuthService, SESSION_COOKIE } from '../auth/auth.service';
import { DB, type Database } from '../db/db.module';
import type { PaymentActor } from './payments.service';

/**
 * Resolves who is calling the Payments API: a merchant server with "Authorization: Bearer <api key>",
 * or a logged-in buyer with the session cookie. Merchants must be APPROVED.
 */
@Injectable()
export class PaymentActorResolver {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly auth: AuthService,
  ) {}

  async resolve(req: Request): Promise<PaymentActor> {
    const header = req.headers.authorization;
    if (header?.startsWith('Bearer ')) {
      const key = header.slice(7).trim();
      const prefix = key.split('.')[0];
      const [row] = await this.db
        .select({ keyHash: merchantApiKeys.keyHash, merchantId: merchantApiKeys.merchantId, status: merchants.status })
        .from(merchantApiKeys)
        .innerJoin(merchants, eq(merchantApiKeys.merchantId, merchants.id))
        .where(and(eq(merchantApiKeys.keyPrefix, prefix), isNull(merchantApiKeys.revokedAt)));
      if (!row || !safeEqual(row.keyHash, sha256Hex(key))) throw new UnauthorizedException('Invalid API key');
      if (row.status !== 'APPROVED') throw new ForbiddenException('This merchant is not approved to accept payments');
      return { kind: 'merchant', merchantId: row.merchantId };
    }
    const userId = this.auth.verifySession(req.cookies?.[SESSION_COOKIE]);
    if (!userId) throw new UnauthorizedException('You need to log in');
    const user = await this.auth.sessionUser(userId);
    if (user.role !== 'BUYER') throw new ForbiddenException('Only buyer accounts can pay for orders');
    return { kind: 'buyer', user };
  }
}
