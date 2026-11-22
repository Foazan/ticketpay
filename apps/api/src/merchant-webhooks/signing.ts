import { createHmac } from 'node:crypto';
import { safeEqual } from '@ticketpay/database';
import { WEBHOOK_TOLERANCE_SECONDS } from '@ticketpay/shared';

/**
 * Outbound webhook signature: "v1=" + hex HMAC-SHA256 over `${timestamp}.${rawBody}` with the merchant's secret.
 * Signing the timestamp stops an attacker replaying an old delivery with a fresh timestamp header.
 */
export function signWebhook(secret: string, timestamp: number, rawBody: string): string {
  return 'v1=' + createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
}

export type VerifyResult = { ok: true } | { ok: false; reason: 'missing_headers' | 'stale_timestamp' | 'bad_signature' };

/** What a merchant runs on receipt. Exported so the demo receiver and the docs use exactly the same check. */
export function verifyWebhook(
  secret: string,
  headers: { timestamp?: string; signature?: string },
  rawBody: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): VerifyResult {
  if (!headers.timestamp || !headers.signature) return { ok: false, reason: 'missing_headers' };
  const ts = Number(headers.timestamp);
  if (!Number.isInteger(ts) || Math.abs(nowSeconds - ts) > WEBHOOK_TOLERANCE_SECONDS) return { ok: false, reason: 'stale_timestamp' };
  return safeEqual(signWebhook(secret, ts, rawBody), headers.signature) ? { ok: true } : { ok: false, reason: 'bad_signature' };
}
