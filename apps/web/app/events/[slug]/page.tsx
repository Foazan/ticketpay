import type { EventDetail } from '@ticketpay/shared';
import { CalendarDays, MapPin, User } from 'lucide-react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { TierSelector } from '@/components/tier-selector';
import { Badge } from '@/components/ui';
import { ApiError, serverFetch } from '@/lib/api';
import { formatDate, formatTime } from '@/lib/format';

export const dynamic = 'force-dynamic';

async function load(slug: string): Promise<EventDetail> {
  try {
    return await serverFetch<EventDetail>(`/v1/events/${encodeURIComponent(slug)}`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) notFound();
    throw err;
  }
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const event = await load((await params).slug);
  return { title: event.title };
}

function Info({ icon, title, sub }: { icon: ReactNode; title: string; sub: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-accent-teal">{icon}</span>
      <div>
        <p className="text-label">{title}</p>
        <p className="text-body-sm text-ink-secondary">{sub}</p>
      </div>
    </div>
  );
}

export default async function EventDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const event = await load((await params).slug);
  return (
    <div className="container-page grid gap-12 py-12 lg:grid-cols-[1fr_420px]">
      <article className="space-y-8">
        <div className="overflow-hidden rounded-lg bg-brand-navy-700">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={event.posterPath} alt={`Poster for ${event.title}`} className="aspect-[8/5] w-full object-cover" />
        </div>
        <div className="space-y-2">
          <Badge>{event.category.name}</Badge>
          <h1 className="text-h1">{event.title}</h1>
          <p className="text-ink-secondary">Organized by {event.organizer}</p>
        </div>
        <div className="flex flex-wrap gap-x-12 gap-y-4">
          <Info icon={<CalendarDays size={20} aria-hidden />} title={formatDate(event.startAt)} sub={`${formatTime(event.startAt)} to ${formatTime(event.endAt)}`} />
          <Info icon={<MapPin size={20} aria-hidden />} title={event.venue} sub={event.city} />
          <Info icon={<User size={20} aria-hidden />} title={event.organizer} sub="Approved organizer" />
        </div>
        <section className="space-y-3">
          <h2 className="text-h3">About this event</h2>
          <p className="text-ink-secondary">{event.description}</p>
          {event.requiresIdCheck && <p className="text-body-sm text-ink-secondary">Bring an ID: staff may check the ticket holder's name at the gate.</p>}
        </section>
      </article>
      <div className="lg:sticky lg:top-8 lg:h-fit">
        <TierSelector tiers={event.tiers} />
      </div>
    </div>
  );
}
