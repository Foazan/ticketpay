import { RoleHome } from '@/components/role-home';
import { serverFetch } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { requireRole } from '@/lib/require-role';
import { cookieHeader } from '@/lib/session';

export const dynamic = 'force-dynamic';

type GateEvent = { id: string; title: string; venue: string; city: string; startAt: string };

export default async function GateHome() {
  await requireRole('GATE_STAFF', '/gate');
  const events = await serverFetch<GateEvent[]>('/v1/gate/events', await cookieHeader());
  return (
    <RoleHome title="Gate" intro="Events you are authorised to validate tickets for." stats={[['Assigned events', events.length]]}>
      <ul className="grid gap-4 md:grid-cols-2">
        {events.map((e) => (
          <li key={e.id} className="card space-y-1 p-6">
            <p className="text-title">{e.title}</p>
            <p className="text-body-sm text-ink-secondary">{formatDateTime(e.startAt)} · {e.venue}, {e.city}</p>
          </li>
        ))}
      </ul>
    </RoleHome>
  );
}
