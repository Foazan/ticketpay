'use client';

import { formatRupiah, PAYMENT_METHOD_LABEL, type OrderView } from '@ticketpay/shared';
import clsx from 'clsx';
import { Check, Clock, X } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { apiFetch } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { Badge, ButtonLink } from './ui';

function useCountdown(until: string) {
  const [left, setLeft] = useState(() => new Date(until).getTime() - Date.now());
  useEffect(() => {
    const t = setInterval(() => setLeft(new Date(until).getTime() - Date.now()), 1000);
    return () => clearInterval(t);
  }, [until]);
  const s = Math.max(0, Math.floor(left / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-body-sm text-ink-secondary">{label}</dt>
      <dd className="text-label">{children}</dd>
    </div>
  );
}

const TONE = {
  PENDING: { icon: Clock, ring: 'bg-status-warning-soft text-status-warning', title: 'Waiting for payment' },
  PAID: { icon: Check, ring: 'bg-status-success-soft text-status-success', title: 'Payment verified' },
  FAILED: { icon: X, ring: 'bg-status-danger-soft text-status-danger', title: 'Payment failed' },
  EXPIRED: { icon: Clock, ring: 'bg-status-danger-soft text-status-danger', title: 'Payment window expired' },
  REFUNDED: { icon: X, ring: 'bg-bg-muted text-ink-secondary', title: 'Order refunded' },
} as const;

/** Polls the API while the order is pending. The page never decides on its own that a payment succeeded. */
export function OrderStatusView({ initial }: { initial: OrderView }) {
  const [order, setOrder] = useState(initial);
  const countdown = useCountdown(order.holdExpiresAt);

  useEffect(() => {
    if (order.status !== 'PENDING' && order.tickets.issued === order.tickets.minted) return;
    const t = setInterval(async () => {
      try {
        setOrder(await apiFetch<OrderView>(`/v1/orders/${order.id}`));
      } catch {
        /* keep the last known state and try again */
      }
    }, 3000);
    return () => clearInterval(t);
  }, [order.id, order.status, order.tickets.issued, order.tickets.minted]);

  const tone = TONE[order.status];
  const Icon = tone.icon;
  const p = order.payment;
  const body = {
    PENDING: p ? 'Complete the payment on the payment page. This page updates by itself once the payment is verified.' : 'Choose a payment method to continue.',
    PAID: 'We confirmed your payment with the provider. Your tickets are issued and listed in My Tickets.',
    FAILED: 'The payment was declined. No ticket was issued and your reserved tickets were released.',
    EXPIRED: 'The payment was not completed in time. No ticket was issued and your reserved tickets were released.',
    REFUNDED: 'This order was refunded and its tickets were cancelled.',
  }[order.status];

  return (
    <div className="card mx-auto flex max-w-xl flex-col items-center gap-6 p-8 shadow-card" aria-live="polite">
      <span className={clsx('flex h-16 w-16 items-center justify-center rounded-full', tone.ring)}>
        <Icon size={32} aria-hidden />
      </span>
      <div className="space-y-2 text-center">
        <h1 className="text-h2">{tone.title}</h1>
        <p className="text-ink-secondary">{body}</p>
      </div>
      <dl className="w-full space-y-3 rounded-md bg-bg-page p-4">
        <Row label="Order">{order.orderNumber}</Row>
        <Row label="Event">{order.event.title}</Row>
        <Row label="Amount">{formatRupiah(order.total)}</Row>
        {p && <Row label="Method">{PAYMENT_METHOD_LABEL[p.method].title}{p.provider === 'MOCK' ? ' (demo)' : ''}</Row>}
        {order.status === 'PENDING' && <Row label="Pay within">{countdown}</Row>}
        <Row label="Payment status">
          <Badge tone={order.status === 'PAID' ? 'success' : order.status === 'PENDING' ? 'pending' : order.status === 'FAILED' ? 'failed' : 'neutral'}>{p?.status ?? 'Not started'}</Badge>
        </Row>
        {order.status === 'PAID' && (
          <Row label="Tickets">
            {order.tickets.issued} issued · {order.tickets.minted === order.tickets.issued ? 'recorded on Sepolia' : 'on-chain record pending'}
          </Row>
        )}
        {p?.paidAt && <Row label="Paid at">{formatDateTime(p.paidAt)}</Row>}
      </dl>
      <div className="flex flex-wrap justify-center gap-3">
        {order.status === 'PENDING' && p?.redirectUrl && <ButtonLink href={p.redirectUrl}>Continue payment</ButtonLink>}
        {order.status === 'PAID' && <ButtonLink href="/buyer/tickets">View my tickets</ButtonLink>}
        {(order.status === 'FAILED' || order.status === 'EXPIRED') && <ButtonLink href={`/events/${order.event.slug}`}>Start a new order</ButtonLink>}
        <ButtonLink href="/events" variant="ghost">Explore more events</ButtonLink>
      </div>
    </div>
  );
}
