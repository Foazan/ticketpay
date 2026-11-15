import type { ReactNode } from 'react';

export function RoleHome({ title, intro, stats, children }: { title: string; intro: string; stats: [string, string | number][]; children?: ReactNode }) {
  return (
    <div className="container-page space-y-8 py-12">
      <div className="space-y-2">
        <h1 className="text-h1">{title}</h1>
        <p className="text-ink-secondary">{intro}</p>
      </div>
      <dl className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map(([label, value]) => (
          <div key={label} className="card space-y-2 p-6">
            <dt className="text-label text-ink-secondary">{label}</dt>
            <dd className="text-h2">{value}</dd>
          </div>
        ))}
      </dl>
      {children}
      <p className="text-body-sm text-ink-muted">The full dashboard for this role is built in a later phase. The figures above are read from the database.</p>
    </div>
  );
}
