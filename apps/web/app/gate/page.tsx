import type { Metadata } from 'next';
import Link from 'next/link';
import { Badge, EmptyState } from '@/components/ui';
import { serverFetch } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import type { GateEvent } from '@/lib/gate';
import { requireRole } from '@/lib/require-role';
import { cookieHeader } from '@/lib/session';

export const metadata: Metadata = { title: 'Gate' };
export const dynamic = 'force-dynamic';

export default async function GateHome() {
  await requireRole('GATE_STAFF', '/gate');
  const events = await serverFetch<GateEvent[]>('/v1/gate/events', await cookieHeader());
  return (
    <div className="container-page space-y-8 py-12">
      <div className="space-y-2">
        <h1 className="text-h1">Gate</h1>
        <p className="text-ink-secondary">Choose the event you are checking tickets for. You can only validate events an administrator has assigned to you.</p>
      </div>
      {events.length === 0 ? (
        <EmptyState title="No events assigned" body="Ask an administrator to assign you to an event before doors open." />
      ) : (
        <ul className="grid gap-6 md:grid-cols-2">
          {events.map((e) => (
            <li key={e.id}>
              <Link
                href={`/gate/${e.id}`}
                className="card block space-y-3 p-6 shadow-card transition-colors hover:border-accent-teal focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-teal"
              >
                <div className="space-y-1">
                  <p className="text-title">{e.title}</p>
                  <p className="text-body-sm text-ink-secondary">
                    {formatDateTime(e.startAt)} · {e.venue}, {e.city}
                  </p>
                  {e.requiresIdCheck && (
                    <span className="mt-1 inline-block">
                      <Badge tone="pending">Photo ID check required</Badge>
                    </span>
                  )}
                </div>
                <p className="text-body-sm">
                  <span className="text-h3">{e.admitted}</span> <span className="text-ink-secondary">of {e.ticketsIssued} tickets admitted</span>
                </p>
                <p className="text-label text-ink-accent">Open scanner →</p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
