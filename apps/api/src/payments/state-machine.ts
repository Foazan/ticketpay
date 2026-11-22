import type { PaymentStatus } from '@ticketpay/shared';

/**
 * Forward-only payment state machine. A notification that would move a payment backwards
 * (for example "pending" arriving after "settlement") is recorded and ignored.
 */
const NEXT: Record<PaymentStatus, PaymentStatus[]> = {
  PENDING: ['PAID', 'FAILED', 'EXPIRED'],
  PAID: ['REFUND_PENDING', 'REFUNDED'],
  REFUND_PENDING: ['REFUNDED'],
  FAILED: [],
  EXPIRED: [],
  REFUNDED: [],
};

export type Transition = 'same' | 'forward' | 'not_allowed';

export function classifyTransition(from: PaymentStatus, to: PaymentStatus): Transition {
  if (from === to) return 'same';
  return NEXT[from].includes(to) ? 'forward' : 'not_allowed';
}

/**
 * Maps a Midtrans transaction_status (and fraud_status) to an internal status.
 * Midtrans: a payment is successful when transaction_status is settlement or capture and fraud_status,
 * when present, is accept. Returns null for statuses this prototype does not act on (partial_refund).
 * Source: docs.midtrans.com, HTTP(S) Notification / Webhooks, checked 22 Nov 2026.
 */
export function mapMidtransStatus(transactionStatus: string, fraudStatus?: string | null): PaymentStatus | null {
  const fraud = fraudStatus?.toLowerCase();
  switch (transactionStatus.toLowerCase()) {
    case 'settlement':
    case 'capture':
      if (!fraud || fraud === 'accept') return 'PAID';
      if (fraud === 'deny') return 'FAILED';
      return 'PENDING'; // "challenge" on older accounts: wait for a final decision
    case 'pending':
    case 'authorize':
      return 'PENDING';
    case 'deny':
    case 'cancel':
    case 'failure':
      return 'FAILED';
    case 'expire':
      return 'EXPIRED';
    case 'refund':
      return 'REFUNDED';
    default:
      return null;
  }
}
