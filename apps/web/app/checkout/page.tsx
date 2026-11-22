import { parseItemsParam, type PaymentMethod, type Quote } from '@ticketpay/shared';
import { Info } from 'lucide-react';
import type { Metadata } from 'next';
import { CheckoutForm } from '@/components/checkout-form';
import { OrderSummary } from '@/components/order-summary';
import { ButtonLink, EmptyState } from '@/components/ui';
import { ApiError, serverFetch } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { requireRole } from '@/lib/require-role';

export const metadata: Metadata = { title: 'Checkout' };
export const dynamic = 'force-dynamic';

type Methods = { provider: 'MOCK' | 'MIDTRANS'; mode: 'mock' | 'sandbox'; methods: { id: PaymentMethod; title: string; description: string }[] };

export default async function CheckoutPage({ searchParams }: { searchParams: Promise<{ event?: string; items?: string }> }) {
  const { event = '', items = '' } = await searchParams;
  const user = await requireRole('BUYER', `/checkout?event=${encodeURIComponent(event)}&items=${encodeURIComponent(items)}`);

  if (!event || parseItemsParam(items).length === 0) {
    return (
      <div className="container-page py-16">
        <EmptyState title="Nothing to check out" body="Choose tickets on an event page first." action={<ButtonLink href="/events">Explore events</ButtonLink>} />
      </div>
    );
  }

  let quote: Quote;
  try {
    quote = await serverFetch<Quote>(`/v1/checkout/quote?event=${encodeURIComponent(event)}&items=${encodeURIComponent(items)}`);
  } catch (err) {
    if (err instanceof ApiError && [400, 404, 409].includes(err.status)) {
      return (
        <div className="container-page py-16">
          <EmptyState title="These tickets can't be bought right now" body={err.message} action={<ButtonLink href={`/events/${event}`}>Back to event</ButtonLink>} />
        </div>
      );
    }
    throw err;
  }
  const methods = await serverFetch<Methods>('/v1/payments/methods');

  return (
    <div className="container-page grid gap-12 py-12 lg:grid-cols-[1fr_420px]">
      <div className="space-y-6">
        <h1 className="text-h1">Checkout</h1>
        <p className="flex items-start gap-3 rounded-md bg-status-info-soft p-4 text-body-sm">
          <Info size={20} className="mt-0.5 shrink-0 text-status-info" aria-hidden />
          {methods.mode === 'mock'
            ? 'Demo mode. Payments here are simulated on a labelled demo page. No money moves and no payment provider is contacted.'
            : 'Sandbox mode. This payment runs in Midtrans Sandbox and no real money is charged.'}
        </p>
        <CheckoutForm
          eventSlug={quote.event.slug}
          items={quote.lines.map((l) => ({ tierId: l.tierId, quantity: l.quantity }))}
          total={quote.total}
          methods={methods.methods}
          buyer={{ name: user.fullName, email: user.email }}
        />
      </div>
      <aside className="lg:sticky lg:top-8 lg:h-fit">
        <OrderSummary
          title={quote.event.title}
          subtitle={`${formatDateTime(quote.event.startAt)} · ${quote.event.city}`}
          posterPath={quote.event.posterPath}
          lines={quote.lines}
          subtotal={quote.subtotal}
          feeRateBps={quote.feeRateBps}
          serviceFee={quote.serviceFee}
          total={quote.total}
          footnote="Your tickets are held for 15 minutes once you continue to payment."
        />
      </aside>
    </div>
  );
}
