import type { Metadata } from 'next';
import { AdminAction, AssignEvent, GateStaffForm } from '@/components/admin/actions';
import { PageHeader } from '@/components/organizer/page-header';
import { serverFetch } from '@/lib/api';
import type { AdminEventRow, GateStaff } from '@/lib/admin';
import { formatDate } from '@/lib/format';
import { cookieHeader } from '@/lib/session';

export const metadata: Metadata = { title: 'Gate staff' };

export default async function GateStaffPage() {
  const cookies = await cookieHeader();
  const [staff, events] = await Promise.all([serverFetch<GateStaff[]>('/v1/admin/gate-staff', cookies), serverFetch<AdminEventRow[]>('/v1/admin/events?status=PUBLISHED', cookies)]);
  return (
    <>
      <PageHeader
        title="Gate staff"
        intro="Accounts that scan tickets at the venue. A gate staff account can only check tickets for the events assigned to it here."
      />
      <GateStaffForm />
      {staff.length === 0 ? (
        <p className="text-body-sm text-ink-secondary">No gate staff accounts yet.</p>
      ) : (
        <ul className="grid gap-4 xl:grid-cols-2">
          {staff.map((s) => {
            const assigned = new Set(s.events.map((e) => e.eventId));
            return (
              <li key={s.id} className="card min-w-0 space-y-4 p-5">
                <div>
                  <p className="text-title">{s.fullName}</p>
                  <p className="break-all text-caption text-ink-secondary">{s.email}</p>
                  <p className="text-caption text-ink-muted">
                    Since {formatDate(s.createdAt)} · {s.admissions.toLocaleString('id-ID')} admissions
                  </p>
                </div>
                {s.events.length === 0 ? (
                  <p className="text-body-sm text-ink-secondary">No events assigned: this account cannot scan tickets yet.</p>
                ) : (
                  <ul className="divide-y divide-line">
                    {s.events.map((e) => (
                      <li key={e.eventId} className="flex flex-wrap items-center justify-between gap-2 py-2 text-body-sm">
                        <span className="min-w-0">
                          {e.title}
                          <span className="block text-caption text-ink-secondary">{formatDate(e.startAt)}</span>
                        </span>
                        <AdminAction label="Remove" small variant="ghost" method="DELETE" path={`/v1/admin/gate-staff/${s.id}/events/${e.eventId}`} />
                      </li>
                    ))}
                  </ul>
                )}
                <AssignEvent staffId={s.id} events={events.filter((e) => !assigned.has(e.id)).map((e) => ({ id: e.id, title: e.title }))} />
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
