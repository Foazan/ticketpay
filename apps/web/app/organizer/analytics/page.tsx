import { formatRupiah } from '@ticketpay/shared';
import clsx from 'clsx';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Meter } from '@/components/organizer/column-chart';
import { PageHeader, Stat } from '@/components/organizer/page-header';
import { SalesChart } from '@/components/organizer/sales-chart';
import { DataTable, Td, Th } from '@/components/organizer/table';
import { serverFetch } from '@/lib/api';
import type { Analytics } from '@/lib/organizer';
import { cookieHeader } from '@/lib/session';

export const metadata: Metadata = { title: 'Sales analytics' };

const RANGES = [7, 30, 90];
const METHOD: Record<string, string> = { VA: 'Virtual account', QRIS: 'QRIS', EWALLET: 'E-wallet' };

export default async function SalesAnalytics({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const { days: d } = await searchParams;
  const days = RANGES.includes(Number(d)) ? Number(d) : 30;
  const a = await serverFetch<Analytics>(`/v1/organizer/analytics?days=${days}`, await cookieHeader());
  const ticketsInRange = a.daily.reduce((s, x) => s + x.tickets, 0);
  const events = [...new Map(a.byTier.map((t) => [t.eventId, t.eventTitle])).entries()];
  return (
    <>
      <PageHeader title="Sales analytics" intro="Ticket sales by day and by category, and how each payment splits between the service fee and your estimated net." />

      {/* One row of filters, above everything it scopes. */}
      <nav aria-label="Period" className="flex gap-2">
        {RANGES.map((r) => (
          <Link
            key={r}
            href={`/organizer/analytics?days=${r}`}
            aria-current={r === days ? 'true' : undefined}
            className={clsx('rounded-md border px-4 py-2 text-label', r === days ? 'border-accent-teal bg-accent-teal-soft' : 'border-line bg-bg-surface hover:bg-bg-muted')}
          >
            Last {r} days
          </Link>
        ))}
      </nav>

      <section className="card space-y-4 p-6" aria-labelledby="daily-heading">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="daily-heading" className="text-title">
            Tickets sold per day
          </h2>
          <p className="text-body-sm text-ink-secondary">{ticketsInRange.toLocaleString('id-ID')} tickets in this period</p>
        </div>
        <SalesChart data={a.daily} measure="tickets" title={`Tickets sold per day, last ${days} days`} />
      </section>

      <section aria-labelledby="fees-heading" className="space-y-3">
        <h2 id="fees-heading" className="text-title">
          Fee breakdown, all time
        </h2>
        <dl className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Stat label="Collected from buyers" value={formatRupiah(a.feeBreakdown.gross)} note="Tickets plus service fee" />
          <Stat label="TicketPay service fee" value={formatRupiah(a.feeBreakdown.serviceFee)} note="Illustrative 3% prototype rate, paid by the buyer" />
          <Stat label="Provider fee" value={a.feeBreakdown.providerFee == null ? 'Not known' : formatRupiah(a.feeBreakdown.providerFee)} note="Not reported in the sandbox, so not deducted" />
          <Stat label="Estimated organizer net" value={formatRupiah(a.feeBreakdown.organizerNet)} note="Internal estimate, not settled funds" />
        </dl>
      </section>

      <section aria-labelledby="tiers-heading" className="space-y-3">
        <h2 id="tiers-heading" className="text-title">
          Sales by ticket category
        </h2>
        {events.length === 0 ? (
          <p className="card p-6 text-body-sm text-ink-secondary">No ticket categories yet.</p>
        ) : (
          <DataTable
            caption="Sales by ticket category"
            head={
              <>
                <Th>Event and category</Th>
                <Th right>Price</Th>
                <Th>Sold of quota</Th>
                <Th right>Held now</Th>
                <Th right>Ticket revenue</Th>
              </>
            }
          >
            {a.byTier.map((t) => (
              <tr key={t.tierId}>
                <Td>
                  {t.tierName}
                  <span className="block text-caption text-ink-secondary">{t.eventTitle}</span>
                </Td>
                <Td right>{formatRupiah(t.price)}</Td>
                <Td>
                  <Meter value={t.sold} max={t.quota} label={`${t.eventTitle} ${t.tierName}: sold out of quota`} />
                </Td>
                <Td right>{t.held}</Td>
                <Td right>{formatRupiah(t.revenue)}</Td>
              </tr>
            ))}
          </DataTable>
        )}
      </section>

      <section aria-labelledby="methods-heading" className="space-y-3">
        <h2 id="methods-heading" className="text-title">
          Paid by payment method
        </h2>
        <DataTable
          caption="Paid by payment method"
          head={
            <>
              <Th>Method</Th>
              <Th right>Payments</Th>
              <Th right>Amount collected</Th>
            </>
          }
          empty={a.paymentMethods.length === 0 && <p className="p-6 text-body-sm text-ink-secondary">No paid orders yet.</p>}
        >
          {a.paymentMethods.map((m) => (
            <tr key={m.method}>
              <Td>{METHOD[m.method] ?? m.method}</Td>
              <Td right>{m.count.toLocaleString('id-ID')}</Td>
              <Td right>{formatRupiah(m.amount)}</Td>
            </tr>
          ))}
        </DataTable>
      </section>
    </>
  );
}
