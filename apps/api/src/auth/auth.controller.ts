import { Body, Controller, Get, HttpCode, Inject, Ip, Post, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  loginSchema,
  registerOrganizerSchema,
  registerSchema,
  type LoginInput,
  type RegisterInput,
  type RegisterOrganizerInput,
  type SessionUser,
} from '@ticketpay/shared';
import type { Response } from 'express';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { CurrentUser, Public } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { AuthService, SESSION_COOKIE, SESSION_TTL_SECONDS } from './auth.service';

const forgotSchema = z.object({ email: z.string().trim().toLowerCase().email() });

@Controller('v1/auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly audit: AuditService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private setSession(res: Response, userId: string) {
    res.cookie(SESSION_COOKIE, this.auth.signSession(userId), {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.env.NODE_ENV === 'production',
      path: '/',
      maxAge: SESSION_TTL_SECONDS * 1000,
    });
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('register')
  async register(@Body(new ZodPipe(registerSchema)) body: RegisterInput, @Res({ passthrough: true }) res: Response, @Ip() ip: string) {
    const user = await this.auth.register(body);
    this.setSession(res, user.id);
    await this.audit.record({ actorId: user.id, actorRole: user.role, action: 'user.registered', entityType: 'User', entityId: user.id, ipAddress: ip });
    return { user };
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('register-organizer')
  async registerOrganizer(
    @Body(new ZodPipe(registerOrganizerSchema)) body: RegisterOrganizerInput,
    @Res({ passthrough: true }) res: Response,
    @Ip() ip: string,
  ) {
    const user = await this.auth.registerOrganizer(body);
    this.setSession(res, user.id);
    await this.audit.record({
      actorId: user.id,
      actorRole: user.role,
      action: 'merchant.registered',
      entityType: 'Merchant',
      entityId: user.merchant?.id,
      ipAddress: ip,
    });
    return { user };
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200)
  @Post('login')
  async login(@Body(new ZodPipe(loginSchema)) body: LoginInput, @Res({ passthrough: true }) res: Response, @Ip() ip: string) {
    const user = await this.auth.login(body);
    this.setSession(res, user.id);
    await this.audit.record({ actorId: user.id, actorRole: user.role, action: 'user.logged_in', entityType: 'User', entityId: user.id, ipAddress: ip });
    return { user };
  }

  @Public()
  @HttpCode(200)
  @Post('logout')
  logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  }

  @Get('me')
  me(@CurrentUser() user: SessionUser) {
    return { user };
  }

  /** Interface only in the prototype: no email is sent. The reply is the same whether or not the account exists. */
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(200)
  @Post('forgot-password')
  forgotPassword(@Body(new ZodPipe(forgotSchema)) _body: { email: string }) {
    return { ok: true, message: 'If an account exists for that email, password reset instructions have been sent.' };
  }
}
