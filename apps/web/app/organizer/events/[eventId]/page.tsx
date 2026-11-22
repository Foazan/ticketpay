import { formatRupiah } from '@ticketpay/shared';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { EventActions, PosterUpload } from '@/components/organizer/event-actions';
import { EventForm } from '@/components/organizer/event-form';
import { PageHeader } from '@/components/organizer/page-header';
import { TierManager } from '@/components/organizer/tier-manager';
import { Badge } from '@/components/ui';
import { ApiError, serverFetch } from '@/lib/api';
import { EVENT_STATUS_BADGE, type OrganizerEvent } from '@/lib/organizer';
import { requireRole } from '@/lib/require-role';
import { cookieHeader } from '@/lib/session';

export const metadata: Metadata = { title: 'Manage event' };

export default async function ManageEvent({ params, searchParams }: { params: Promise<{ eventId: string }>; searchParams: Promise<{ created?: string }> }) {
  const { eventId } = await params;
  const { created } = await searchParams;
  const user = await requireRole('ORGANIZER', `/organizer/events/${eventId}`);
  const cookies = await cookieHeader();
  let event: OrganizerEvent;
  try {
    event = await serverFetch<OrganizerEvent>(`/v1/organizer/events/${encodeURIComponent(eventId)}`, cookies);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) notFound();
    throw err;
  }
  const categories = await serverFetch<{ id: string; name: string }[]>('/v1/categories');
  const badge = EVENT_STATUS_BADGE[event.status];
  const sold = event.tiers.reduce((s, t) => s + t.soldCount, 0);
  const quota = event.tiers.reduce((s, t) => s + t.quota, 0);
  const potential = event.tiers.reduce((s, t) => s + t.quota * t.price, 0);

  return (
    <>
      <Link href="/organizer/events" className="text-body-sm text-ink-accent hover:underline">
        ← Events
      </Link>
      <PageHeader
        title={event.title}
        intro={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={badge.tone}>{badge.label}</Badge>
            {event.status === 'PUBLISHED' && (
              <Link href={`/events/${event.slug}`} className="text-ink-accent hover:underline">
                View public page →
              </Link>
            )}
          </span>
        }
      />
      {created && (
        <p role="status" className="rounded-md bg-status-success-soft p-4 text-body-sm">
          Draft created. Add ticket categories and a poster, then publish.
        </p>
      )}

      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-6">
          <section className="card space-y-4 p-6" aria-labelledby="tiers-heading">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 id="tiers-heading" className="text-title">
                Ticket categories
              </h2>
              <p className="text-body-sm text-ink-secondary">
                {sold.toLocaleString('id-ID')} of {quota.toLocaleString('id-ID')} sold · up to {formatRupiah(potential)} if sold out
              </p>
            </div>
            <TierManager event={event} />
          </section>
          <section className="card space-y-4 p-6" aria-labelledby="details-heading">
            <h2 id="details-heading" className="text-title">
              Event details
            </h2>
            <EventForm categories={categories} event={event} />
          </section>
        </div>
        <div className="space-y-6">
          <section className="card space-y-4 p-6" aria-labelledby="status-heading">
            <h2 id="status-heading" className="text-title">
              Status
            </h2>
            <EventActions event={event} approved={user.merchant?.status === 'APPROVED'} />
            {event.orderCount > 0 && <p className="text-caption text-ink-secondary">{event.orderCount} orders so far, so this event can be archived but not deleted.</p>}
          </section>
          <section className="card space-y-4 p-6" aria-labelledby="poster-heading">
            <h2 id="poster-heading" className="text-title">
              Poster
            </h2>
            <PosterUpload event={event} />
          </section>
        </div>
      </div>
    </>
  );
}
