import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { GateScanner } from '@/components/gate-scanner';
import { serverFetch } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import type { GateEvent } from '@/lib/gate';
import { requireRole } from '@/lib/require-role';
import { cookieHeader } from '@/lib/session';

export const metadata: Metadata = { title: 'Scanner' };
export const dynamic = 'force-dynamic';

export default async function GateScannerPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  await requireRole('GATE_STAFF', `/gate/${eventId}`);
  const events = await serverFetch<GateEvent[]>('/v1/gate/events', await cookieHeader());
  // Only events assigned to this staff member. The API enforces the same rule on every scan.
  const event = events.find((e) => e.id === eventId);
  if (!event) notFound();
  return (
    <div className="container-page space-y-6 py-8">
      <div className="space-y-1">
        <Link href="/gate" className="text-body-sm text-ink-accent hover:underline">
          ← Change event
        </Link>
        <h1 className="text-h2">{event.title}</h1>
        <p className="text-body-sm text-ink-secondary">
          {formatDateTime(event.startAt)} · {event.venue}, {event.city}
        </p>
      </div>
      <GateScanner eventId={event.id} initialAdmitted={event.admitted} ticketsIssued={event.ticketsIssued} />
    </div>
  );
}
