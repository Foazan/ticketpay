import type { ReactNode } from 'react';

export function PageHeader({ title, intro, actions }: { title: string; intro?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="space-y-1">
        <h1 className="text-h2">{title}</h1>
        {intro && <p className="max-w-2xl text-body-sm text-ink-secondary">{intro}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-3">{actions}</div>}
    </div>
  );
}

/** Stat tile: label, value, optional note. Figures come straight from the API. */
export function Stat({ label, value, note }: { label: string; value: ReactNode; note?: ReactNode }) {
  return (
    <div className="card space-y-1 p-5">
      <dt className="text-label text-ink-secondary">{label}</dt>
      <dd className="text-h3">{value}</dd>
      {note && <dd className="text-caption text-ink-muted">{note}</dd>}
    </div>
  );
}
