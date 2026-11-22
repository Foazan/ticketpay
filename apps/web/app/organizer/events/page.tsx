import { formatRupiah } from '@ticketpay/shared';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Meter } from '@/components/organizer/column-chart';
import { PageHeader } from '@/components/organizer/page-header';
import { Badge, ButtonLink, EmptyState } from '@/components/ui';
import { serverFetch } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { posterSrc } from '@/lib/media';
import { EVENT_STATUS_BADGE, type OrganizerEventRow } from '@/lib/organizer';
import { cookieHeader } from '@/lib/session';

export const metadata: Metadata = { title: 'Events' };

export default async function OrganizerEvents() {
  const rows = await serverFetch<OrganizerEventRow[]>('/v1/organizer/events', await cookieHeader());
  return (
    <>
      <PageHeader title="Events" intro="Drafts stay private until you publish them. Published events appear in the marketplace." actions={<ButtonLink href="/organizer/events/new">Create event</ButtonLink>} />
      {rows.length === 0 ? (
        <EmptyState title="No events yet" body="Create your first event, add ticket categories, then publish it." action={<ButtonLink href="/organizer/events/new">Create event</ButtonLink>} />
      ) : (
        <ul className="space-y-3">
          {rows.map((e) => {
            const badge = EVENT_STATUS_BADGE[e.status];
            return (
              <li key={e.id}>
                <Link
                  href={`/organizer/events/${e.id}`}
                  className="card grid gap-4 p-4 transition-colors hover:border-accent-teal focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-teal sm:grid-cols-[8rem_minmax(0,1fr)_14rem] sm:items-center"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={posterSrc(e.posterPath)} alt="" className="hidden aspect-[8/5] w-full rounded-md object-cover sm:block" />
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-title">{e.title}</p>
                      <Badge tone={badge.tone}>{badge.label}</Badge>
                    </div>
                    <p className="text-body-sm text-ink-secondary">
                      {formatDateTime(e.startAt)} · {e.venue}, {e.city}
                    </p>
                    <p className="text-caption text-ink-muted">
                      {e.tierCount} ticket {e.tierCount === 1 ? 'category' : 'categories'} · {formatRupiah(e.revenue)} ticket revenue
                    </p>
                  </div>
                  <Meter value={e.sold} max={e.quota} label={`${e.title}: tickets sold out of quota`} />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
