import { formatRupiah, type EventSummary } from '@ticketpay/shared';
import { CalendarDays, MapPin } from 'lucide-react';
import Link from 'next/link';
import { formatDate } from '@/lib/format';
import { posterSrc } from '@/lib/media';

export function EventCard({ event }: { event: EventSummary }) {
  return (
    <Link href={`/events/${event.slug}`} className="card group flex flex-col overflow-hidden shadow-card transition hover:-translate-y-0.5">
      <div className="relative aspect-[8/5] bg-brand-navy-700">
        {/* Local SVG poster; a plain img avoids the image optimizer for SVG. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={posterSrc(event.posterPath)} alt="" className="h-full w-full object-cover" loading="lazy" />
        <span className="absolute left-3 top-3 rounded-full bg-bg-surface px-3 py-1 text-caption">{event.category.name}</span>
      </div>
      <div className="flex flex-1 flex-col gap-2 p-4">
        <h3 className="text-title group-hover:text-ink-accent">{event.title}</h3>
        <p className="flex items-center gap-2 text-body-sm text-ink-secondary">
          <CalendarDays size={16} aria-hidden /> {formatDate(event.startAt)}
        </p>
        <p className="flex items-center gap-2 text-body-sm text-ink-secondary">
          <MapPin size={16} aria-hidden /> {event.city}
        </p>
        <div className="mt-auto flex items-center justify-between pt-2">
          <span className="text-caption text-ink-muted">{event.ticketsAvailable > 0 ? 'From' : 'Sold out'}</span>
          <span className="text-title text-ink-accent">{event.fromPrice === null ? 'Not on sale' : formatRupiah(event.fromPrice)}</span>
        </div>
      </div>
    </Link>
  );
}

export function EventGrid({ events }: { events: EventSummary[] }) {
  return (
    <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {events.map((e) => (
        <EventCard key={e.id} event={e} />
      ))}
    </div>
  );
}
