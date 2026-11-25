import { formatRupiah } from '@ticketpay/shared';
import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader, Stat } from '@/components/organizer/page-header';
import { RECON_ORDER, RECON_STATUS } from '@/components/organizer/recon-table';
import { SalesChart } from '@/components/organizer/sales-chart';
import { Badge } from '@/components/ui';
import { serverFetch } from '@/lib/api';
import { percent, type AdminOverview } from '@/lib/admin';
import { cookieHeader } from '@/lib/session';

export const metadata: Metadata = { title: 'Administration' };

const n = (v: number | undefined) => (v ?? 0).toLocaleString('id-ID');
const count = (k: number, one: string, many: string) => `${k.toLocaleString('id-ID')} ${k === 1 ? one : many}`;

export default async function AdminOverviewPage() {
  const o = await serverFetch<AdminOverview>('/v1/admin/overview', await cookieHeader());
  const attention = [
    (o.merchants.PENDING ?? 0) > 0 && { href: '/admin/merchants?status=PENDING', text: `${count(o.merchants.PENDING ?? 0, 'organizer application awaits', 'organizer applications await')} approval` },
    o.webhooks.failed > 0 && { href: '/admin/webhooks?status=FAILED', text: `${count(o.webhooks.failed, 'merchant webhook', 'merchant webhooks')} gave up and can be retried` },
    o.tickets.mintFailed > 0 && { href: '/admin/blockchain', text: `${count(o.tickets.mintFailed, 'ticket', 'tickets')} failed to mint` },
    o.reconciliation.INVESTIGATE + o.reconciliation.MISMATCH > 0 && {
      href: '/admin/reconciliation',
      text: `${count(o.reconciliation.INVESTIGATE + o.reconciliation.MISMATCH, 'payment needs', 'payments need')} a look in reconciliation`,
    },
    o.chain.mode !== 'disabled' && !o.chain.ready && { href: '/admin/blockchain', text: `Blockchain not ready: ${o.chain.problem ?? 'unknown problem'}` },
  ].filter(Boolean) as { href: string; text: string }[];

  return (
    <>
      <PageHeader title="Platform overview" intro="Live figures from TicketPay's database across every organizer." />
      <dl className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Collected (gross)" value={formatRupiah(o.money.gross)} note={o.money.refunds > 0 ? `${formatRupiah(o.money.refunds)} refunded (simulated)` : 'Ticket subtotals plus service fees'} />
        <Stat label="Service fee revenue" value={formatRupiah(o.money.serviceFees)} note={`Current rate ${percent(o.feeRateBps)}, net of refunds`} />
        <Stat label="Paid payments" value={n(o.payments.PAID)} note={`${n(o.payments.PENDING)} pending · ${n(o.payments.REFUNDED)} refunded`} />
        <Stat label="Tickets issued" value={n(o.tickets.issued)} note={`${n(o.tickets.minted)} minted · ${n(o.tickets.redeemed)} admitted`} />
        <Stat label="Approved organizers" value={n(o.merchants.APPROVED)} note={`${n(o.merchants.PENDING)} awaiting · ${n(o.merchants.SUSPENDED)} suspended`} />
        <Stat label="Events on sale" value={n(o.events.PUBLISHED)} note={`${n(o.events.DRAFT)} drafts · ${n(o.events.UNPUBLISHED)} unpublished`} />
        <Stat label="Webhooks needing attention" value={n(o.webhooks.failed)} note={`${n(o.webhooks.retrying)} retrying now`} />
        <Stat
          label="Blockchain"
          value={o.chain.mode === 'disabled' ? 'Off' : o.chain.ready ? 'Ready' : 'Not ready'}
          note={o.chain.network}
        />
      </dl>

      {attention.length > 0 && (
        <section aria-labelledby="attention" className="card space-y-3 p-5">
          <h2 id="attention" className="text-title">
            Needs attention
          </h2>
          <ul className="space-y-2 text-body-sm">
            {attention.map((a) => (
              <li key={a.href + a.text}>
                <Link href={a.href} className="text-ink-accent underline-offset-2 hover:underline">
                  {a.text}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card space-y-4 p-5">
        <SalesChart data={o.dailyVolume} measure="revenue" title="Paid volume per day, last 30 days (WIB)" />
      </section>

      <section aria-labelledby="recon" className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="recon" className="text-h3">
            Reconciliation
          </h2>
          <Link href="/admin/reconciliation" className="text-label text-ink-accent">
            Open reconciliation
          </Link>
        </div>
        <ul className="flex flex-wrap gap-3">
          {RECON_ORDER.map((s) => (
            <li key={s}>
              <Badge tone={RECON_STATUS[s].tone}>
                {RECON_STATUS[s].label}: {o.reconciliation[s].toLocaleString('id-ID')}
              </Badge>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
