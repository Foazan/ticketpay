import type { SessionUser } from '@ticketpay/shared';
import { cookies } from 'next/headers';
import { ApiError, serverFetch } from './api';

/** The visitor's cookies as a header string, for forwarding to the API. */
export async function cookieHeader(): Promise<string> {
  const store = await cookies();
  return store
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');
}

/** The logged-in user, or null. The API decides; the web app never trusts its own copy of the role. */
export async function getSession(): Promise<SessionUser | null> {
  const header = await cookieHeader();
  if (!header.includes('tp_session=')) return null;
  try {
    const { user } = await serverFetch<{ user: SessionUser }>('/v1/auth/me', header);
    return user;
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return null;
    throw err;
  }
}
