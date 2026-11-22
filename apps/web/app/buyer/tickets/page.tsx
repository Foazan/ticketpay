import type { Metadata } from 'next';
import Link from 'next/link';
import { AutoRefresh } from '@/components/auto-refresh';
import { Badge, ButtonLink, EmptyState } from '@/components/ui';
import { serverFetch } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { requireRole } from '@/lib/require-role';
import { cookieHeader } from '@/lib/session';
import { mintBadge, ticketGroup, ticketStatusBadge, type TicketRow } from '@/lib/tickets';

export const metadata: Metadata = { title: 'My Tickets' };
export const dynamic = 'force-dynamic';

const SECTIONS = [
  { key: 'upcoming', title: 'Upcoming', empty: null },
  { key: 'used', title: 'Used', empty: null },
  { key: 'inactive', title: 'Cancelled or past', empty: null },
] as const;

function TicketCard({ t }: { t: TicketRow }) {
  const chain = mintBadge(t);
  const status = ticketStatusBadge(t);
  return (
    <Link
      href={`/buyer/tickets/${t.id}`}
      className="card block space-y-1 p-6 shadow-card transition-colors hover:border-accent-teal focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-teal"
    >
      <p className="text-title">{t.eventTitle}</p>
      <p className="text-body-sm text-ink-secondary">{formatDateTime(t.eventStartAt)}</p>
      <p className="text-body-sm text-ink-secondary">
        {t.venue}, {t.city}
      </p>
      <p className="flex flex-wrap items-center gap-2 pt-2">
        <Badge>{t.tierName}</Badge>
        <Badge tone={status.tone}>{status.label}</Badge>
        <Badge tone={chain.tone}>{chain.label}</Badge>
      </p>
      {t.status === 'ACTIVE' && ticketGroup(t) === 'upcoming' && <p className="pt-1 text-body-sm text-ink-accent">Show entry QR →</p>}
    </Link>
  );
}

export default async function MyTicketsPage() {
  await requireRole('BUYER', '/buyer/tickets');
  const tickets = await serverFetch<TicketRow[]>('/v1/tickets', await cookieHeader());
  const minting = tickets.some((t) => t.chain.enabled && t.status !== 'CANCELLED' && (t.mintStatus === 'PENDING' || t.mintStatus === 'SUBMITTED'));
  const groups = Object.fromEntries(SECTIONS.map((s) => [s.key, tickets.filter((t) => ticketGroup(t) === s.key)]));
  return (
    <div className="container-page space-y-8 py-12">
      <AutoRefresh active={minting} />
      <div>
        <h1 className="text-h1">My Tickets</h1>
        <p className="text-body-sm text-ink-secondary">Open a ticket to show its entry QR at the gate and to see its ownership record.</p>
      </div>
      {tickets.length === 0 ? (
        <EmptyState title="You have no tickets yet" body="Tickets appear here after a payment is verified." action={<ButtonLink href="/events">Explore events</ButtonLink>} />
      ) : (
        SECTIONS.filter((s) => groups[s.key].length > 0).map((s) => (
          <section key={s.key} aria-labelledby={`tickets-${s.key}`} className="space-y-4">
            <h2 id={`tickets-${s.key}`} className="text-h3">
              {s.title} <span className="text-ink-secondary">({groups[s.key].length})</span>
            </h2>
            <ul className="grid gap-6 md:grid-cols-2">
              {groups[s.key].map((t) => (
                <li key={t.id}>
                  <TicketCard t={t} />
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
