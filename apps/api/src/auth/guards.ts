import { CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { CSRF_HEADER, CSRF_HEADER_VALUE, type Role } from '@ticketpay/shared';
import type { Request } from 'express';
import { IS_PUBLIC, ROLES_KEY } from '../common/decorators';
import { AuthService, SESSION_COOKIE } from './auth.service';

/**
 * Authenticates every request from the session cookie unless the route is @Public().
 * The user is re-read from the database each time, so a deleted account or a changed role takes effect at once.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [context.getHandler(), context.getClass()]);
    if (isPublic) return true;
    const req = context.switchToHttp().getRequest<Request & { user?: unknown }>();
    const userId = this.auth.verifySession(req.cookies?.[SESSION_COOKIE]);
    if (!userId) throw new UnauthorizedException('You need to log in');
    req.user = await this.auth.sessionUser(userId);
    return true;
  }
}

/** Enforces @Roles(). Frontend redirects are a convenience; this is the actual access control. */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, [context.getHandler(), context.getClass()]);
    if (!roles || roles.length === 0) return true;
    const user = context.switchToHttp().getRequest().user as { role: Role } | undefined;
    if (!user || !roles.includes(user.role)) throw new ForbiddenException('Your account cannot access this resource');
    return true;
  }
}

export const SKIP_CSRF = 'skipCsrf';
/** For server-to-server routes (provider webhooks) that are authenticated by signature instead of a cookie. */
export const SkipCsrf = () => SetMetadata(SKIP_CSRF, true);

/**
 * CSRF defence for cookie-authenticated requests: every state-changing request must carry a custom header.
 * A cross-site form or image cannot set it, and a cross-site fetch needs a CORS preflight that only WEB_ORIGIN passes.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return true;
    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_CSRF, [context.getHandler(), context.getClass()]);
    if (skip) return true;
    if (req.headers[CSRF_HEADER] !== CSRF_HEADER_VALUE) throw new ForbiddenException('Missing CSRF header');
    return true;
  }
}
