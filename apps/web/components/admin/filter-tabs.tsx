import clsx from 'clsx';
import Link from 'next/link';

/** Status filter as links, so the filter lives in the URL and works without JavaScript. */
export function FilterTabs({ base, param = 'status', current, options }: { base: string; param?: string; current: string; options: { value: string; label: string }[] }) {
  return (
    <nav aria-label="Filter" className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <ul className="flex gap-2">
        {[{ value: '', label: 'All' }, ...options].map((o) => {
          const active = o.value === current;
          return (
            <li key={o.value || 'all'}>
              <Link
                href={o.value ? `${base}?${param}=${o.value}` : base}
                aria-current={active ? 'page' : undefined}
                className={clsx(
                  'inline-flex whitespace-nowrap rounded-full border px-4 py-2 text-label transition-colors',
                  active ? 'border-accent-teal bg-accent-teal-soft text-ink-primary' : 'border-line text-ink-secondary hover:bg-bg-muted',
                )}
              >
                {o.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
