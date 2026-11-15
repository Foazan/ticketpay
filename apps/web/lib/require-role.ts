import { ROLE_HOME, type Role, type SessionUser } from '@ticketpay/shared';
import { redirect } from 'next/navigation';
import { getSession } from './session';

/**
 * Redirects visitors without the right role. This is a convenience for navigation only:
 * the API enforces the same rule on every request, so skipping this check reveals nothing.
 */
export async function requireRole(role: Role, path: string): Promise<SessionUser> {
  const user = await getSession();
  if (!user) redirect(`/login?next=${encodeURIComponent(path)}`);
  if (user.role !== role) redirect(ROLE_HOME[user.role]);
  return user;
}
