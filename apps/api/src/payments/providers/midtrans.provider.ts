import { Logger } from '@nestjs/common';
import type { PaymentMethod } from '@ticketpay/shared';
import { createHash } from 'node:crypto';
import { safeEqual } from '@ticketpay/database';
import {
  ProviderUnavailableError,
  type CreateTransactionInput,
  type CreateTransactionResult,
  type PaymentProvider,
  type ProviderStatus,
} from './provider';

/** Snap enabled_payments values per method group (docs.midtrans.com, Request Body JSON Parameter). */
export const MIDTRANS_ENABLED_PAYMENTS: Record<PaymentMethod, string[]> = {
  VA: ['bca_va', 'bni_va', 'bri_va', 'permata_va', 'echannel'],
  QRIS: ['other_qris'],
  EWALLET: ['gopay', 'shopeepay'],
};

export interface MidtransConfig {
  serverKey: string;
  snapUrl: string;
  apiUrl: string;
  webOrigin: string;
  enabledMethods: PaymentMethod[];
}

/** Midtrans expects "yyyy-MM-dd HH:mm:ss +0700" for expiry.start_time. */
export function formatJakarta(d: Date): string {
  const j = new Date(d.getTime() + 7 * 3600_000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${j.getUTCFullYear()}-${pad(j.getUTCMonth() + 1)}-${pad(j.getUTCDate())} ${pad(j.getUTCHours())}:${pad(j.getUTCMinutes())}:${pad(j.getUTCSeconds())} +0700`;
}

/**
 * signature_key = SHA512(order_id + status_code + gross_amount + Signature Secret Key), lowercase hex.
 * Midtrans switched from the Server Key to the separate Signature Secret Key on 28 Oct 2026
 * (docs.midtrans.com/docs/access-keys). The two differ once a new Server Key is generated.
 */
export function midtransSignature(orderId: string, statusCode: string, grossAmount: string, signatureSecretKey: string): string {
  return createHash('sha512').update(orderId + statusCode + grossAmount + signatureSecretKey).digest('hex');
}

/** True if the notification was signed with any of the given keys (more than one only while rotating). */
export function verifyMidtransSignature(
  body: { order_id: string; status_code: string; gross_amount: string; signature_key: string },
  signatureSecretKeys: string[],
): boolean {
  const received = String(body.signature_key).toLowerCase();
  return signatureSecretKeys.some((key) => safeEqual(midtransSignature(body.order_id, body.status_code, body.gross_amount, key), received));
}

/** Midtrans Snap Sandbox adapter. The server key never leaves this process. */
export class MidtransPaymentProvider implements PaymentProvider {
  readonly kind = 'MIDTRANS' as const;
  private readonly log = new Logger('Midtrans');

  constructor(private readonly config: MidtransConfig) {}

  private get authHeader() {
    return 'Basic ' + Buffer.from(`${this.config.serverKey}:`).toString('base64');
  }

  methods(): PaymentMethod[] {
    return this.config.enabledMethods;
  }

  async createTransaction(input: CreateTransactionInput): Promise<CreateTransactionResult> {
    const body = {
      transaction_details: { order_id: input.reference, gross_amount: input.amount },
      // item_details must add up to gross_amount, so the service fee is its own line.
      item_details: input.items.map((i) => ({ id: i.id.slice(0, 50), name: i.name.slice(0, 50), price: i.price, quantity: i.quantity })),
      // Only what the payment page needs. No phone or address unless the buyer gave one.
      customer_details: { first_name: input.customer.name.slice(0, 255), email: input.customer.email, ...(input.customer.phone ? { phone: input.customer.phone } : {}) },
      enabled_payments: MIDTRANS_ENABLED_PAYMENTS[input.method],
      callbacks: { finish: `${this.config.webOrigin}/orders/${input.orderId}/status` },
      expiry: { start_time: formatJakarta(input.holdStartedAt), unit: 'minutes', duration: input.holdMinutes },
    };
    let res: Response;
    try {
      res = await fetch(this.config.snapUrl, {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/json', authorization: this.authHeader },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err) {
      throw new ProviderUnavailableError(`Midtrans could not be reached: ${(err as Error).message}`);
    }
    const json = (await res.json().catch(() => ({}))) as { token?: string; redirect_url?: string; error_messages?: string[] };
    if (!res.ok || !json.redirect_url) {
      // Error messages from Midtrans contain no secrets; log them for setup troubleshooting.
      this.log.error(`Snap transaction failed (${res.status}): ${(json.error_messages ?? []).join('; ')}`);
      throw new ProviderUnavailableError(
        res.status === 401 ? 'Midtrans rejected the server key. Check MIDTRANS_SERVER_KEY (Sandbox).' : `Midtrans returned ${res.status}`,
      );
    }
    return { snapToken: json.token ?? null, redirectUrl: json.redirect_url };
  }

  async getStatus(reference: string): Promise<ProviderStatus | null> {
    let res: Response;
    try {
      res = await fetch(`${this.config.apiUrl}/v2/${encodeURIComponent(reference)}/status`, {
        headers: { accept: 'application/json', authorization: this.authHeader },
        signal: AbortSignal.timeout(10_000),
      });
    } catch (err) {
      throw new ProviderUnavailableError(`Midtrans could not be reached: ${(err as Error).message}`);
    }
    const json = (await res.json().catch(() => ({}))) as Record<string, string | undefined>;
    // Midtrans answers HTTP 200 with status_code "404" for an unknown order.
    if (res.status === 404 || json.status_code === '404') return null;
    if (!res.ok || !json.transaction_status) throw new ProviderUnavailableError(`Midtrans status check returned ${res.status}`);
    return {
      reference,
      transactionStatus: json.transaction_status,
      statusCode: json.status_code ?? '',
      fraudStatus: json.fraud_status ?? null,
      grossAmount: json.gross_amount ?? '',
      paymentType: json.payment_type ?? null,
      transactionId: json.transaction_id ?? null,
    };
  }
}
