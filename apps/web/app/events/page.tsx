import { EVENT_SORTS, type EventSummary, type Paginated } from '@ticketpay/shared';
import type { Metadata } from 'next';
import Link from 'next/link';
import { EventCard } from '@/components/event-card';
import { EmptyState } from '@/components/ui';
import { ApiError, serverFetch } from '@/lib/api';

export const metadata: Metadata = { title: 'Explore Events' };
export const dynamic = 'force-dynamic';

const SORT_LABEL: Record<(typeof EVENT_SORTS)[number], string> = {
  date_asc: 'Date, soonest first',
  date_desc: 'Date, latest first',
  price_asc: 'Price, low to high',
  price_desc: 'Price, high to low',
  popular: 'Most popular',
};
const FILTER_KEYS = ['q', 'category', 'city', 'dateFrom', 'maxPrice', 'featured', 'sort', 'page'] as const;

export default async function ExplorePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = await searchParams;
  const params = new URLSearchParams();
  for (const key of FILTER_KEYS) {
    const v = raw[key];
    if (typeof v === 'string' && v !== '') params.set(key, v);
  }
  const value = (k: string) => params.get(k) ?? '';

  const [categories, cities] = await Promise.all([
    serverFetch<{ name: string; slug: string }[]>('/v1/categories'),
    serverFetch<string[]>('/v1/cities'),
  ]);
  let result: Paginated<EventSummary> | null = null;
  let invalid = false;
  try {
    result = await serverFetch<Paginated<EventSummary>>(`/v1/events?${params.toString()}`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 400) invalid = true;
    else throw err;
  }
  const pages = result ? Math.max(1, Math.ceil(result.total / result.pageSize)) : 1;
  const pageHref = (p: number) => {
    const next = new URLSearchParams(params);
    next.set('page', String(p));
    return `/events?${next.toString()}`;
  };

  return (
    <div className="container-page grid gap-8 py-12 lg:grid-cols-[280px_1fr]">
      <form action="/events" className="card flex h-fit flex-col gap-6 p-6">
        <h2 className="text-h3">Filters</h2>
        <div>
          <label htmlFor="q" className="field-label">Search</label>
          <input id="q" name="q" defaultValue={value('q')} placeholder="Event, city or category" className="field" />
        </div>
        <div>
          <label htmlFor="category" className="field-label">Category</label>
          <select id="category" name="category" defaultValue={value('category')} className="field">
            <option value="">All categories</option>
            {categories.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="city" className="field-label">City</label>
          <select id="city" name="city" defaultValue={value('city')} className="field">
            <option value="">All cities</option>
            {cities.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="dateFrom" className="field-label">Date from</label>
          <input id="dateFrom" name="dateFrom" type="date" defaultValue={value('dateFrom')} className="field" />
        </div>
        <div>
          <label htmlFor="maxPrice" className="field-label">Maximum price (Rp)</label>
          <input id="maxPrice" name="maxPrice" type="number" min={0} step={5000} defaultValue={value('maxPrice')} placeholder="150000" className="field" />
        </div>
        <div>
          <label htmlFor="sort" className="field-label">Sort by</label>
          <select id="sort" name="sort" defaultValue={value('sort') || 'date_asc'} className="field">
            {EVENT_SORTS.map((s) => <option key={s} value={s}>{SORT_LABEL[s]}</option>)}
          </select>
        </div>
        <button type="submit" className="rounded-md bg-brand-navy px-6 py-3 text-label text-ink-inverse">Apply filters</button>
        <Link href="/events" className="text-center text-label text-ink-accent">Reset filters</Link>
      </form>

      <section className="space-y-6">
        <div>
          <h1 className="text-h1">Explore Events</h1>
          <p className="text-body-sm text-ink-secondary">{result ? `${result.total} ${result.total === 1 ? 'event' : 'events'} found` : 'Check your filters'}</p>
        </div>
        {invalid && <EmptyState title="Those filters are not valid" body="One of the filter values could not be read. Reset the filters and try again." />}
        {result && result.items.length === 0 && <EmptyState title="No events match your filters" body="Try a different city or category, or remove the price limit." />}
        {result && result.items.length > 0 && (
          <div className="grid gap-8 sm:grid-cols-2 xl:grid-cols-3">
            {result.items.map((e) => <EventCard key={e.id} event={e} />)}
          </div>
        )}
        {result && pages > 1 && (
          <nav className="flex items-center justify-center gap-4 text-label" aria-label="Pagination">
            {result.page > 1 && <Link href={pageHref(result.page - 1)} className="text-ink-accent">Previous</Link>}
            <span className="text-ink-secondary">Page {result.page} of {pages}</span>
            {result.page < pages && <Link href={pageHref(result.page + 1)} className="text-ink-accent">Next</Link>}
          </nav>
        )}
      </section>
    </div>
  );
}
