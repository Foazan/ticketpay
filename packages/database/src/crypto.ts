// Small crypto helpers shared by the API and the seed script.
import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';

function key(encKeyHex: string): Buffer {
  const k = Buffer.from(encKeyHex, 'hex');
  if (k.length !== 32) {
    throw new Error('WEBHOOK_SECRET_ENC_KEY must be 64 hex characters (32 bytes). Run "pnpm secrets" to generate one.');
  }
  return k;
}

/** Encrypts a merchant webhook secret with AES-256-GCM. Output: iv.tag.ciphertext, base64url. */
export function encryptSecret(plain: string, encKeyHex: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(encKeyHex), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString('base64url')).join('.');
}

export function decryptSecret(payload: string, encKeyHex: string): string {
  const [iv, tag, data] = payload.split('.').map((p) => Buffer.from(p, 'base64url'));
  const decipher = createDecipheriv('aes-256-gcm', key(encKeyHex), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

export const sha256Hex = (s: string) => createHash('sha256').update(s).digest('hex');

/** Constant-time comparison of two hex or plain strings. */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function generateWebhookSecret(): string {
  return `whsec_${randomBytes(24).toString('base64url')}`;
}

/** Merchant API key: "tp_test_<8 hex>.<secret>". Only the prefix and a SHA-256 of the full key are stored. */
export function generateApiKey(): { key: string; prefix: string; hash: string; lastFour: string } {
  const prefix = `tp_test_${randomBytes(4).toString('hex')}`;
  const key = `${prefix}.${randomBytes(24).toString('base64url')}`;
  return { key, prefix, hash: sha256Hex(key), lastFour: key.slice(-4) };
}
