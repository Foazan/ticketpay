import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Role, SessionUser } from '@ticketpay/shared';

export const IS_PUBLIC = 'isPublic';
/** Marks a route as reachable without a session. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const ROLES_KEY = 'roles';
/** Restricts a route or controller to the listed roles. Enforced by RolesGuard on the server. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

/** The authenticated user, loaded from the database by AuthGuard on every request. */
export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): SessionUser => {
  return ctx.switchToHttp().getRequest().user;
});
