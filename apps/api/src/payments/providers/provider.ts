import type { PaymentMethod } from '@ticketpay/shared';

export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');

export interface CreateTransactionInput {
  paymentId: string;
  reference: string;
  orderId: string;
  amount: number;
  method: PaymentMethod;
  items: { id: string; name: string; price: number; quantity: number }[];
  customer: { name: string; email: string; phone?: string | null };
  holdStartedAt: Date;
  holdMinutes: number;
}

export interface CreateTransactionResult {
  snapToken: string | null;
  redirectUrl: string;
}

/** A provider's view of a payment, normalised. Fields follow Midtrans naming. */
export interface ProviderStatus {
  reference: string;
  transactionStatus: string;
  statusCode: string;
  fraudStatus: string | null;
  grossAmount: string;
  paymentType: string | null;
  transactionId: string | null;
}

export interface PaymentProvider {
  readonly kind: 'MOCK' | 'MIDTRANS';
  /** Methods this provider is configured to offer. Checkout only shows these. */
  methods(): PaymentMethod[];
  createTransaction(input: CreateTransactionInput): Promise<CreateTransactionResult>;
  /** The provider's current status for a payment, or null if the provider does not know it. */
  getStatus(reference: string): Promise<ProviderStatus | null>;
}

export class ProviderUnavailableError extends Error {}
