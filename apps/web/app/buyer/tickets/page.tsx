import type { Metadata } from 'next';
import Link from 'next/link';
import { AutoRefresh } from '@/components/auto-refresh';
import { Badge, ButtonLink, EmptyState } from '@/components/ui';
import { serverFetch } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { requireRole } from '@/lib/require-role';
import { cookieHeader } from '@/lib/session';
import { mintBadge, type TicketRow } from '@/lib/tickets';

export const metadata: Metadata = { title: 'My Tickets' };
export const dynamic = 'force-dynamic';

export default async function MyTicketsPage() {
  await requireRole('BUYER', '/buyer/tickets');
  const tickets = await serverFetch<TicketRow[]>('/v1/tickets', await cookieHeader());
  const minting = tickets.some((t) => t.chain.enabled && t.status === 'ACTIVE' && (t.mintStatus === 'PENDING' || t.mintStatus === 'SUBMITTED'));
  return (
    <div className="container-page space-y-6 py-12">
      <AutoRefresh active={minting} />
      <div>
        <h1 className="text-h1">My Tickets</h1>
        <p className="text-body-sm text-ink-secondary">Tickets linked to your account. Open a ticket to see its ownership record. QR entry codes arrive in the next build.</p>
      </div>
      {tickets.length === 0 ? (
        <EmptyState title="You have no tickets yet" body="Tickets appear here after a payment is verified." action={<ButtonLink href="/events">Explore events</ButtonLink>} />
      ) : (
        <ul className="grid gap-6 md:grid-cols-2">
          {tickets.map((t) => {
            const badge = mintBadge(t);
            return (
              <li key={t.id}>
                <Link
                  href={`/buyer/tickets/${t.id}`}
                  className="card block space-y-1 p-6 shadow-card transition-shadow hover:border-accent-teal focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-teal"
                >
                  <p className="text-title">{t.eventTitle}</p>
                  <p className="text-body-sm text-ink-secondary">{formatDateTime(t.eventStartAt)}</p>
                  <p className="text-body-sm text-ink-secondary">
                    {t.venue}, {t.city}
                  </p>
                  <p className="flex flex-wrap items-center gap-2 pt-2">
                    <Badge>{t.tierName}</Badge>
                    <Badge tone={t.status === 'ACTIVE' ? 'success' : 'neutral'}>{t.status === 'ACTIVE' ? 'Active' : t.status}</Badge>
                    <Badge tone={badge.tone}>{badge.label}</Badge>
                  </p>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
