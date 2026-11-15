import { CSRF_HEADER, CSRF_HEADER_VALUE } from '@ticketpay/shared';

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

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
export async function apiFetch<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const method = init.method ?? 'GET';
  const res = await fetch(`${API_URL}${path}`, {
    method,
    credentials: 'include',
    headers: {
      ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(method !== 'GET' ? { [CSRF_HEADER]: CSRF_HEADER_VALUE } : {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  return parse<T>(res);
}

/** Server-side call from a server component. Forwards the visitor's cookies and never caches. */
export async function serverFetch<T>(path: string, cookieHeader?: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    cache: 'no-store',
    headers: cookieHeader ? { cookie: cookieHeader } : {},
  });
  return parse<T>(res);
}
