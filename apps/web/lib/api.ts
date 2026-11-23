import { CSRF_HEADER, CSRF_HEADER_VALUE } from '@ticketpay/shared';

/**
 * Base URL the browser uses for the API. Empty (the default) means same-origin: requests go to
 * /v1/... on this app, which forwards them to the API (see next.config.mjs). Set NEXT_PUBLIC_API_URL
 * only to call the API on another origin directly.
 */
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '';

/** Base URL for server-side calls from this app to the API. */
const SERVER_API_URL = process.env.API_INTERNAL_URL || API_URL || 'http://localhost:4000';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public fieldErrors: { field: string; message: string }[] = [],
  ) {
    super(message);
  }
}

async function parse<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const message = typeof body?.message === 'string' ? body.message : `Request failed (${res.status})`;
    throw new ApiError(res.status, message, Array.isArray(body?.errors) ? body.errors : []);
  }
  return body as T;
}

/** Browser-side call. Sends the session cookie and the CSRF header on state-changing requests. */
export async function apiFetch<T>(path: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}): Promise<T> {
  const method = init.method ?? 'GET';
  const res = await fetch(`${API_URL}${path}`, {
    method,
    credentials: 'include',
    headers: {
      ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(method !== 'GET' ? { [CSRF_HEADER]: CSRF_HEADER_VALUE } : {}),
      ...init.headers,
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  return parse<T>(res);
}

/** Server-side call from a server component. Forwards the visitor's cookies and never caches. */
export async function serverFetch<T>(path: string, cookieHeader?: string): Promise<T> {
  const res = await fetch(`${SERVER_API_URL}${path}`, {
    cache: 'no-store',
    headers: cookieHeader ? { cookie: cookieHeader } : {},
  });
  return parse<T>(res);
}

/**
 * Where to send the buyer to pay. The demo payment page lives in this app, so it is opened on the
 * address the buyer is already using (a phone on the laptop's network, a tunnel), not on WEB_ORIGIN.
 * A real provider's page (Midtrans Snap) is used as given.
 */
export function paymentPageHref(redirectUrl: string): string {
  try {
    const u = new URL(redirectUrl, 'http://placeholder');
    return u.pathname.startsWith('/pay/mock/') ? u.pathname : redirectUrl;
  } catch {
    return redirectUrl;
  }
}
