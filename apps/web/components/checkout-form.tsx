'use client';

import { formatRupiah, type OrderView, type PaymentMethod, type PaymentView } from '@ticketpay/shared';
import clsx from 'clsx';
import { useState, type FormEvent } from 'react';
import { ApiError, apiFetch, paymentPageHref } from '@/lib/api';
import { Button } from './ui';
import { randomId } from '@/lib/random-id';
import { useHydrated } from '@/lib/use-hydrated';

type Method = { id: PaymentMethod; title: string; description: string };

export function CheckoutForm(props: {
  eventSlug: string;
  items: { tierId: string; quantity: number }[];
  total: number;
  methods: Method[];
  buyer: { name: string; email: string };
}) {
  // Generated once per page load. A double click or a retry reuses them, so it creates one order and one payment.
  const [checkoutKey] = useState(() => randomId());
  const [idempotencyKey] = useState(() => randomId());
  const [method, setMethod] = useState<PaymentMethod | undefined>(props.methods[0]?.id);
  const [busy, setBusy] = useState(false);
  const hydrated = useHydrated();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!method) return;
    setBusy(true);
    setError(null);
    setFieldErrors({});
    const data = Object.fromEntries(new FormData(e.currentTarget).entries()) as Record<string, string>;
    try {
      const order = await apiFetch<OrderView>('/v1/orders', {
        method: 'POST',
        body: {
          eventSlug: props.eventSlug,
          items: props.items,
          checkoutKey,
          buyerName: data.buyerName,
          buyerEmail: data.buyerEmail,
          ...(data.buyerPhone ? { buyerPhone: data.buyerPhone } : {}),
        },
      });
      const payment = await apiFetch<PaymentView>('/v1/payments', {
        method: 'POST',
        body: { orderId: order.id, method },
        headers: { 'idempotency-key': idempotencyKey },
      });
      if (!payment.redirectUrl) throw new Error('The payment page is not available. Open your order to try again.');
      // The redirect back from the payment page is never treated as proof of payment; the status page asks the API.
      window.location.href = paymentPageHref(payment.redirectUrl);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.status === 502 ? 'The payment provider is unavailable right now. Try again in a moment.' : err.message);
        setFieldErrors(Object.fromEntries(err.fieldErrors.map((f) => [f.field, f.message])));
      } else {
        setError(err instanceof Error ? err.message : 'Something went wrong. Try again.');
      }
      setBusy(false);
    }
  }

  const field = (name: string, label: string, defaultValue: string, type = 'text', placeholder?: string) => (
    <div>
      <label htmlFor={name} className="field-label">{label}</label>
      <input id={name} name={name} type={type} defaultValue={defaultValue} placeholder={placeholder} className="field" aria-invalid={!!fieldErrors[name]} required={name !== 'buyerPhone'} />
      {fieldErrors[name] && <p className="mt-2 text-caption text-status-danger">{fieldErrors[name]}</p>}
    </div>
  );

  return (
    <form method="post" onSubmit={onSubmit} className="space-y-6" noValidate>
      <section className="card space-y-4 p-6">
        <h2 className="text-h3">Buyer details</h2>
        <p className="text-body-sm text-ink-secondary">Tickets are issued to your account. The name is shown to gate staff if the event checks ID.</p>
        <div className="grid gap-4 md:grid-cols-2">
          {field('buyerName', 'Full name', props.buyer.name)}
          {field('buyerEmail', 'Email', props.buyer.email, 'email')}
        </div>
        {field('buyerPhone', 'Phone (optional)', '', 'tel', '08xx xxxx xxxx')}
      </section>

      <div className="card space-y-4 p-6" role="radiogroup" aria-labelledby="payment-method-heading">
        <h2 id="payment-method-heading" className="text-h3">Payment method</h2>
        {props.methods.length === 0 && <p className="text-body-sm text-status-danger">No payment methods are configured. Check MIDTRANS_ENABLED_METHODS.</p>}
        {props.methods.map((m) => (
          <label
            key={m.id}
            className={clsx(
              'flex cursor-pointer items-center gap-3 rounded-md border p-4',
              method === m.id ? 'border-accent-teal bg-accent-teal-soft' : 'border-line bg-bg-surface',
            )}
          >
            <input type="radio" name="method" value={m.id} checked={method === m.id} onChange={() => setMethod(m.id)} disabled={!hydrated} className="h-4 w-4 accent-[#0E9AA0]" />
            <span>
              <span className="block text-label">{m.title}</span>
              <span className="block text-caption text-ink-secondary">{m.description}</span>
            </span>
          </label>
        ))}
        <p className="text-caption text-ink-muted">Only methods enabled for this payment configuration are shown.</p>
      </div>

      {error && (
        <p role="alert" className="rounded-md bg-status-danger-soft px-4 py-3 text-body-sm">
          {error}
        </p>
      )}
      <Button type="submit" disabled={busy || !method || !hydrated} className="w-full">
        {busy ? 'Preparing payment…' : `Pay ${formatRupiah(props.total)}`}
      </Button>
    </form>
  );
}
