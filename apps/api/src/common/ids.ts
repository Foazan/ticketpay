import { randomBytes } from 'node:crypto';

// Crockford base32 without I, L, O, U: easy to read aloud at a gate.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function randomCode(length: number): string {
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) out += ALPHABET[bytes[i] % 32];
  return out;
}

const ymd = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, '');

export const newOrderNumber = (now = new Date()) => `TP-${ymd(now)}-${randomCode(6)}`;
/** Sent to the payment provider as order_id (Midtrans allows up to 50 characters). */
export const newPaymentReference = (now = new Date()) => `PAY-${ymd(now)}-${randomCode(10)}`;
export const newValidationCode = () => `TP-${randomCode(4)}-${randomCode(4)}`;
