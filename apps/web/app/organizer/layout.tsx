import type { ReactNode } from 'react';
import { OrganizerNav } from '@/components/organizer/nav';
import { Badge } from '@/components/ui';
import { requireRole } from '@/lib/require-role';

export const dynamic = 'force-dynamic';

const STATUS_NOTE: Record<string, { tone: 'pending' | 'failed'; text: string }> = {
  PENDING: { tone: 'pending', text: 'Your organizer account is waiting for approval by TicketPay. You can prepare events now and publish them once approved.' },
  REJECTED: { tone: 'failed', text: 'Your organizer application was not approved. Contact TicketPay support for details.' },
  SUSPENDED: { tone: 'failed', text: 'Your organizer account is suspended. Events cannot be published and payments are paused.' },
};

export default async function OrganizerLayout({ children }: { children: ReactNode }) {
  const user = await requireRole('ORGANIZER', '/organizer');
  const status = user.merchant?.status ?? 'PENDING';
  const note = STATUS_NOTE[status];
  return (
    <div className="container-page grid grid-cols-[minmax(0,1fr)] gap-8 py-8 lg:grid-cols-[14rem_minmax(0,1fr)]">
      <aside className="min-w-0 space-y-4 lg:sticky lg:top-6 lg:self-start">
        <div className="space-y-1 px-3">
          <p className="text-title">{user.merchant?.businessName ?? 'Organizer'}</p>
          <Badge tone={status === 'APPROVED' ? 'success' : note?.tone ?? 'neutral'}>{status === 'APPROVED' ? 'Approved merchant' : status.toLowerCase()}</Badge>
        </div>
        <OrganizerNav />
      </aside>
      <div className="min-w-0 space-y-6">
        {note && (
          <p role="status" className={note.tone === 'pending' ? 'rounded-md bg-status-warning-soft p-4 text-body-sm' : 'rounded-md bg-status-danger-soft p-4 text-body-sm'}>
            {note.text}
          </p>
        )}
        {children}
      </div>
    </div>
  );
}
