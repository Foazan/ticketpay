import type { EventSummary, Paginated } from '@ticketpay/shared';
import Link from 'next/link';
import { EventGrid } from '@/components/event-card';
import { ButtonLink } from '@/components/ui';
import { serverFetch } from '@/lib/api';

export const dynamic = 'force-dynamic';

const load = (qs: string) => serverFetch<Paginated<EventSummary>>(`/v1/events?pageSize=4&${qs}`).then((r) => r.items);

function Section({ title, href, events }: { title: string; href: string; events: EventSummary[] }) {
  if (events.length === 0) return null;
  return (
    <section className="container-page space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-h2">{title}</h2>
        <Link href={href} className="text-label text-ink-accent">View all</Link>
      </div>
      <EventGrid events={events} />
    </section>
  );
}

export default async function HomePage() {
  const [featured, popular, upcoming, categories, cities] = await Promise.all([
    load('featured=true'),
    load('sort=popular'),
    load('sort=date_asc'),
    serverFetch<{ name: string; slug: string }[]>('/v1/categories'),
    serverFetch<string[]>('/v1/cities'),
  ]);

  return (
    <div className="space-y-16">
      <section className="bg-brand-navy text-ink-inverse">
        <div className="container-page space-y-8 py-16">
          <div className="space-y-4">
            <h1 className="text-h1 md:text-display">Find your next live experience</h1>
            <p className="max-w-2xl opacity-90">
              Concerts, festivals, workshops and sports across Indonesia. Pay with Virtual Account, QRIS or e-wallet and get a verifiable digital ticket.
            </p>
          </div>
          <form action="/events" className="flex max-w-4xl flex-col gap-2 rounded-lg bg-bg-surface p-2 text-ink-primary md:flex-row md:items-end">
            <label className="flex-[2] px-4 py-2">
              <span className="block text-caption text-ink-muted">Event</span>
              <input name="q" placeholder="Search by event name" className="w-full text-body-sm outline-none placeholder:text-ink-secondary" />
            </label>
            <label className="flex-1 px-4 py-2">
              <span className="block text-caption text-ink-muted">Category</span>
              <select name="category" className="w-full bg-transparent text-body-sm outline-none" defaultValue="">
                <option value="">All categories</option>
                {categories.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
              </select>
            </label>
            <label className="flex-1 px-4 py-2">
              <span className="block text-caption text-ink-muted">Location</span>
              <select name="city" className="w-full bg-transparent text-body-sm outline-none" defaultValue="">
                <option value="">All cities</option>
                {cities.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
            <button type="submit" className="rounded-md bg-accent-teal px-6 py-3 text-label text-ink-inverse">Search events</button>
          </form>
        </div>
      </section>

      <section className="container-page space-y-6">
        <h2 className="text-h2">Browse by category</h2>
        <div className="flex flex-wrap gap-3">
          {categories.map((c) => (
            <Link key={c.slug} href={`/events?category=${c.slug}`} className="rounded-full border border-line bg-bg-surface px-6 py-3 text-label hover:border-accent-teal">
              {c.name}
            </Link>
          ))}
        </div>
      </section>

      <Section title="Featured events" href="/events?featured=true" events={featured} />
      <Section title="Popular events" href="/events?sort=popular" events={popular} />
      <Section title="Upcoming events" href="/events?sort=date_asc" events={upcoming} />

      <section className="container-page">
        <div className="flex flex-col items-start justify-between gap-6 rounded-lg bg-accent-teal-soft p-8 md:flex-row md:items-center md:p-12">
          <div className="space-y-2">
            <h2 className="text-h2">Running an event?</h2>
            <p className="max-w-xl text-ink-secondary">Publish events, sell tickets and track every transaction from one dashboard.</p>
          </div>
          <ButtonLink href="/sell">Become an Organizer</ButtonLink>
        </div>
      </section>
    </div>
  );
}
