import { formatRupiah, PAYMENT_METHOD_LABEL, type PaymentView } from '@ticketpay/shared';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { MockPayButtons } from '@/components/mock-pay-buttons';
import { ApiError, serverFetch } from '@/lib/api';
import { requireRole } from '@/lib/require-role';
import { cookieHeader } from '@/lib/session';

export const metadata: Metadata = { title: 'Demo payment' };
export const dynamic = 'force-dynamic';

/**
 * Stand-in for the provider's payment page when PAYMENT_PROVIDER=mock. It is labelled as a demo
 * everywhere and only exists in development builds of the API.
 */
export default async function MockPaymentPage({ params }: { params: Promise<{ paymentId: string }> }) {
  const { paymentId } = await params;
  await requireRole('BUYER', `/pay/mock/${paymentId}`);
  let payment: PaymentView;
  try {
    payment = await serverFetch<PaymentView>(`/v1/payments/${encodeURIComponent(paymentId)}`, await cookieHeader());
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) notFound();
    throw err;
  }
  if (payment.provider !== 'MOCK') notFound();

  return (
    <div className="container-page py-12">
      <div className="mx-auto max-w-xl space-y-6">
        <div className="rounded-md border-2 border-dashed border-status-warning bg-status-warning-soft p-4 text-center">
          <p className="text-title">DEMO PAYMENT — NOT A REAL PAYMENT PAGE</p>
          <p className="text-body-sm">No money moves. Choose an outcome to see how TicketPay handles it.</p>
        </div>
        <div className="card space-y-4 p-8 shadow-card">
          <h1 className="text-h2">Simulated {PAYMENT_METHOD_LABEL[payment.method].title}</h1>
          <dl className="space-y-3 rounded-md bg-bg-page p-4 text-body-sm">
            <div className="flex justify-between"><dt className="text-ink-secondary">Payment reference</dt><dd className="text-label">{payment.reference}</dd></div>
            <div className="flex justify-between"><dt className="text-ink-secondary">Amount</dt><dd className="text-label">{formatRupiah(payment.amount)}</dd></div>
            <div className="flex justify-between"><dt className="text-ink-secondary">Current status</dt><dd className="text-label">{payment.status}</dd></div>
          </dl>
          <MockPayButtons paymentId={payment.id} orderId={payment.orderId} disabled={payment.status !== 'PENDING'} />
          <p className="text-caption text-ink-muted">
            Each button sends the same kind of status update the real provider would send, through the same state machine, ledger and ticket issuance.
          </p>
        </div>
      </div>
    </div>
  );
}
