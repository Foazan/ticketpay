import { BadRequestException, Body, Controller, Get, HttpCode, Inject, Ip, Patch, Post, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { users } from '@ticketpay/database';
import {
  changePasswordSchema,
  updateProfileSchema,
  type Account,
  type ChangePasswordInput,
  type SessionUser,
  type UpdateProfileInput,
} from '@ticketpay/shared';
import * as argon2 from 'argon2';
import { eq, sql } from 'drizzle-orm';
import type { Response } from 'express';
import { AuditService } from '../audit/audit.service';
import { CurrentUser } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { DB, type Database } from '../db/db.module';
import { AuthService, SESSION_COOKIE, SESSION_TTL_SECONDS } from './auth.service';

/**
 * The signed-in user's own account, for every role. Only ever acts on the session's user:
 * there is no id in any route, so nobody can edit someone else's account.
 */
@Controller('v1/account')
export class AccountController {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly auth: AuthService,
    private readonly audit: AuditService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Get()
  async get(@CurrentUser() user: SessionUser): Promise<Account> {
    const [row] = await this.db
      .select({ id: users.id, email: users.email, fullName: users.fullName, phone: users.phone, role: users.role, nameChangedAt: users.nameChangedAt, createdAt: users.createdAt })
      .from(users)
      .where(eq(users.id, user.id));
    return { ...row, nameChangedAt: row.nameChangedAt?.toISOString() ?? null, createdAt: row.createdAt.toISOString() };
  }

  /**
   * Name and phone. A name change is audited with the old and new name, and stamped on the account:
   * the gate shows a warning when the name changed after a ticket was bought, because the ID check
   * compares the photo ID with this name.
   */
  @Patch()
  async update(@CurrentUser() user: SessionUser, @Body(new ZodPipe(updateProfileSchema)) body: UpdateProfileInput, @Ip() ip: string): Promise<Account> {
    const [current] = await this.db.select({ fullName: users.fullName, phone: users.phone }).from(users).where(eq(users.id, user.id));
    const nameChanged = body.fullName !== current.fullName;
    const phone = body.phone === undefined ? current.phone : body.phone || null;
    const phoneChanged = phone !== current.phone;
    if (nameChanged || phoneChanged) {
      await this.db
        .update(users)
        .set({ fullName: body.fullName, phone, ...(nameChanged && { nameChangedAt: new Date() }) })
        .where(eq(users.id, user.id));
      await this.audit.record({
        actorId: user.id,
        actorRole: user.role,
        action: 'user.profile_updated',
        entityType: 'User',
        entityId: user.id,
        metadata: { changed: [...(nameChanged ? ['fullName'] : []), ...(phoneChanged ? ['phone'] : [])], ...(nameChanged && { nameFrom: current.fullName, nameTo: body.fullName }) },
        ipAddress: ip,
      });
    }
    return this.get(user);
  }

  /**
   * Checks the current password, stores the new one and signs out every other session: the session
   * version goes up, so older cookies stop working. This browser gets a fresh cookie.
   */
  @Post('password')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async changePassword(
    @CurrentUser() user: SessionUser,
    @Body(new ZodPipe(changePasswordSchema)) body: ChangePasswordInput,
    @Res({ passthrough: true }) res: Response,
    @Ip() ip: string,
  ) {
    const [row] = await this.db.select({ passwordHash: users.passwordHash }).from(users).where(eq(users.id, user.id));
    const ok = await argon2.verify(row.passwordHash, body.currentPassword).catch(() => false);
    if (!ok) throw new BadRequestException('The current password is incorrect');
    const passwordHash = await argon2.hash(body.newPassword, { type: argon2.argon2id });
    await this.db
      .update(users)
      .set({ passwordHash, sessionVersion: sql`${users.sessionVersion} + 1` })
      .where(eq(users.id, user.id));
    res.cookie(SESSION_COOKIE, await this.auth.signSession(user.id), {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.env.NODE_ENV === 'production',
      path: '/',
      maxAge: SESSION_TTL_SECONDS * 1000,
    });
    await this.audit.record({ actorId: user.id, actorRole: user.role, action: 'user.password_changed', entityType: 'User', entityId: user.id, ipAddress: ip });
    return { ok: true };
  }
}
