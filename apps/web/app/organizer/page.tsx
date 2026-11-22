import { formatRupiah } from '@ticketpay/shared';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Meter } from '@/components/organizer/column-chart';
import { PageHeader, Stat } from '@/components/organizer/page-header';
import { SalesChart } from '@/components/organizer/sales-chart';
import { StatusBadge } from '@/components/organizer/status-badges';
import { Badge, ButtonLink } from '@/components/ui';
import { serverFetch } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { EVENT_STATUS_BADGE, type Overview } from '@/lib/organizer';
import { cookieHeader } from '@/lib/session';

export const metadata: Metadata = { title: 'Organizer overview' };

export default async function OrganizerOverview() {
  const o = await serverFetch<Overview>('/v1/organizer/overview', await cookieHeader());
  const last30 = o.dailySales.reduce((s, d) => s + d.revenue, 0);
  return (
    <>
      <PageHeader title="Overview" intro="Every figure here is read from TicketPay's records of your events and payments." actions={<ButtonLink href="/organizer/events/new">Create event</ButtonLink>} />

      <dl className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <Stat label="Published events" value={`${o.publishedEvents} of ${o.totalEvents}`} />
        <Stat label="Tickets sold" value={o.ticketsSold.toLocaleString('id-ID')} />
        <Stat label="Ticket revenue" value={formatRupiah(o.totalRevenue)} note="Paid orders, before the service fee" />
        <Stat label="Pending payments" value={o.pendingPayments.toLocaleString('id-ID')} note="Orders waiting for the buyer to pay" />
        <Stat label="Estimated balance" value={formatRupiah(o.estimatedBalance)} note="Internal estimate from sandbox payments, not settled funds" />
      </dl>

      <section className="card space-y-4 p-6" aria-labelledby="sales-heading">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="sales-heading" className="text-title">
            Ticket revenue per day, last 30 days
          </h2>
          <p className="text-body-sm text-ink-secondary">{formatRupiah(last30)} in total</p>
        </div>
        <SalesChart data={o.dailySales} measure="revenue" title="Ticket revenue per day, last 30 days" />
      </section>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 xl:grid-cols-2">
        <section className="card space-y-4 p-6" aria-labelledby="recent-heading">
          <div className="flex items-baseline justify-between">
            <h2 id="recent-heading" className="text-title">
              Recent transactions
            </h2>
            <Link href="/organizer/transactions" className="text-body-sm text-ink-accent hover:underline">
              All transactions →
            </Link>
          </div>
          {o.recentTransactions.length === 0 ? (
            <p className="text-body-sm text-ink-secondary">No orders yet.</p>
          ) : (
            <ul className="divide-y divide-line">
              {o.recentTransactions.map((t) => (
                <li key={t.orderId} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-label">{t.buyerName}</p>
                    <p className="truncate text-caption text-ink-secondary">
                      {t.event} · {formatDateTime(t.createdAt)}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span className="text-body-sm tabular-nums">{formatRupiah(t.total)}</span>
                    <StatusBadge status={t.status} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card space-y-4 p-6" aria-labelledby="upcoming-heading">
          <div className="flex items-baseline justify-between">
            <h2 id="upcoming-heading" className="text-title">
              Upcoming events
            </h2>
            <Link href="/organizer/events" className="text-body-sm text-ink-accent hover:underline">
              All events →
            </Link>
          </div>
          {o.upcomingEvents.length === 0 ? (
            <p className="text-body-sm text-ink-secondary">No upcoming events. Create one to start selling.</p>
          ) : (
            <ul className="space-y-4">
              {o.upcomingEvents.map((e) => (
                <li key={e.id} className="space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <Link href={`/organizer/events/${e.id}`} className="min-w-0 truncate text-label hover:underline">
                      {e.title}
                    </Link>
                    <Badge tone={EVENT_STATUS_BADGE[e.status].tone}>{EVENT_STATUS_BADGE[e.status].label}</Badge>
                  </div>
                  <p className="text-caption text-ink-secondary">{formatDateTime(e.startAt)}</p>
                  <Meter value={e.sold} max={e.quota} label={`${e.title}: tickets sold out of quota`} />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
