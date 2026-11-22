import { PAYMENT_METHODS, type PaymentMethod } from '@ticketpay/shared';
import type { CreateTransactionInput, CreateTransactionResult, PaymentProvider, ProviderStatus } from './provider';

/**
 * Labelled demo payments for running TicketPay without Midtrans credentials.
 * No money moves and nothing is sent anywhere: the buyer is sent to a clearly marked demo page,
 * and outcomes are applied through a development-only route (see DevController).
 */
export class MockPaymentProvider implements PaymentProvider {
  readonly kind = 'MOCK' as const;
  constructor(private readonly webOrigin: string) {}

  methods(): PaymentMethod[] {
    return [...PAYMENT_METHODS];
  }

  async createTransaction(input: CreateTransactionInput): Promise<CreateTransactionResult> {
    return { snapToken: null, redirectUrl: `${this.webOrigin}/pay/mock/${input.paymentId}` };
  }

  async getStatus(_reference: string): Promise<ProviderStatus | null> {
    return null; // The mock keeps no state of its own.
  }
}
