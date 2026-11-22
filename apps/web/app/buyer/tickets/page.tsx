import type { Metadata } from 'next';
import { Badge, ButtonLink, EmptyState } from '@/components/ui';
import { serverFetch } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { requireRole } from '@/lib/require-role';
import { cookieHeader } from '@/lib/session';

export const metadata: Metadata = { title: 'My Tickets' };
export const dynamic = 'force-dynamic';

type TicketRow = { id: string; status: string; mintStatus: string; eventTitle: string; eventStartAt: string; venue: string; city: string; tierName: string };

export default async function MyTicketsPage() {
  await requireRole('BUYER', '/buyer/tickets');
  const tickets = await serverFetch<TicketRow[]>('/v1/tickets', await cookieHeader());
  return (
    <div className="container-page space-y-6 py-12">
      <div>
        <h1 className="text-h1">My Tickets</h1>
        <p className="text-body-sm text-ink-secondary">Tickets linked to your account. QR codes and the Sepolia ownership record arrive in the next builds.</p>
      </div>
      {tickets.length === 0 ? (
        <EmptyState title="You have no tickets yet" body="Tickets appear here after a payment is verified." action={<ButtonLink href="/events">Explore events</ButtonLink>} />
      ) : (
        <ul className="grid gap-6 md:grid-cols-2">
          {tickets.map((t) => (
            <li key={t.id} className="card space-y-1 p-6 shadow-card">
              <p className="text-title">{t.eventTitle}</p>
              <p className="text-body-sm text-ink-secondary">{formatDateTime(t.eventStartAt)}</p>
              <p className="text-body-sm text-ink-secondary">{t.venue}, {t.city}</p>
              <p className="flex flex-wrap items-center gap-2 pt-2">
                <Badge>{t.tierName}</Badge>
                <Badge tone={t.status === 'ACTIVE' ? 'success' : 'neutral'}>{t.status === 'ACTIVE' ? 'Active' : t.status}</Badge>
                <Badge tone={t.mintStatus === 'MINTED' ? 'info' : 'pending'}>{t.mintStatus === 'MINTED' ? 'On Sepolia' : 'On-chain record pending'}</Badge>
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
