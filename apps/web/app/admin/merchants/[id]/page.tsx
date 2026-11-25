import { formatRupiah } from '@ticketpay/shared';
import type { Metadata } from 'next';
import Link from 'next/link';
import { AdminAction } from '@/components/admin/actions';
import { PageHeader, Stat } from '@/components/organizer/page-header';
import { Badge } from '@/components/ui';
import { serverFetch } from '@/lib/api';
import { MERCHANT_BADGE, type AdminMerchant } from '@/lib/admin';
import { formatDate, formatDateTime } from '@/lib/format';
import { EVENT_STATUS_BADGE } from '@/lib/organizer';
import { cookieHeader } from '@/lib/session';

export const metadata: Metadata = { title: 'Merchant' };

const ACTION_LABEL: Record<string, string> = {
  'merchant.approved': 'Approved',
  'merchant.rejected': 'Rejected',
  'merchant.suspended': 'Suspended',
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-caption text-ink-secondary">{label}</dt>
      <dd className="break-words text-body-sm">{children || <span className="text-ink-muted">—</span>}</dd>
    </div>
  );
}

export default async function MerchantDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const m = await serverFetch<AdminMerchant>(`/v1/admin/merchants/${id}`, await cookieHeader());
  const badge = MERCHANT_BADGE[m.status];
  return (
    <>
      <p className="text-caption">
        <Link href="/admin/merchants" className="text-ink-accent">
          Merchants
        </Link>{' '}
        / {m.businessName}
      </p>
      <PageHeader title={m.businessName} intro={m.organizerType} actions={<Badge tone={badge.tone}>{badge.label}</Badge>} />
      {m.statusReason && (
        <p className="rounded-md bg-status-danger-soft p-4 text-body-sm">
          <span className="font-medium">Reason given to the organizer:</span> {m.statusReason}
        </p>
      )}

      <section aria-labelledby="decide" className="card space-y-3 p-5">
        <h2 id="decide" className="text-title">
          Decision
        </h2>
        <div className="flex flex-wrap items-start gap-3">
          {m.status !== 'APPROVED' && (
            <AdminAction
              label={m.status === 'PENDING' ? 'Approve' : 'Reactivate'}
              variant="accent"
              path={`/v1/admin/merchants/${m.id}/approve`}
              confirm={`Approve ${m.businessName}? They can publish events and take payments again.`}
            />
          )}
          {m.status === 'PENDING' && (
            <AdminAction label="Reject" variant="danger" path={`/v1/admin/merchants/${m.id}/reject`} reason={{ label: 'Reason for rejecting', hint: 'Shown to the organizer.', required: true }} />
          )}
          {m.status === 'APPROVED' && (
            <AdminAction
              label="Suspend"
              variant="danger"
              path={`/v1/admin/merchants/${m.id}/suspend`}
              reason={{ label: 'Reason for suspending', hint: 'Shown to the organizer. Their events leave the marketplace and new payments stop; tickets already sold stay valid.', required: true }}
            />
          )}
        </div>
      </section>

      <dl className="grid gap-4 sm:grid-cols-3">
        <Stat label="Paid payments" value={m.paidPayments.toLocaleString('id-ID')} />
        <Stat label="Paid volume" value={formatRupiah(m.grossVolume)} />
        <Stat label="Active API keys" value={m.activeApiKeys} />
      </dl>

      <section aria-labelledby="profile" className="card space-y-4 p-5">
        <h2 id="profile" className="text-title">
          Profile
        </h2>
        <dl className="grid gap-4 sm:grid-cols-2">
          <Field label="Account holder">
            {m.fullName} · {m.email}
          </Field>
          <Field label="Contact person">
            {m.contactPerson} · {m.phone}
          </Field>
          <Field label="Address">{m.address}</Field>
          <Field label="Registered">{formatDate(m.createdAt)}</Field>
          <Field label="Description">{m.description}</Field>
          <Field label="Settlement account note">{m.settlementAccountNote}</Field>
          <Field label="Webhook URL">{m.webhookUrl && <span className="font-mono text-caption">{m.webhookUrl}</span>}</Field>
        </dl>
      </section>

      <section aria-labelledby="events" className="card space-y-3 p-5">
        <h2 id="events" className="text-title">
          Events ({m.events.length})
        </h2>
        {m.events.length === 0 ? (
          <p className="text-body-sm text-ink-secondary">No events yet.</p>
        ) : (
          <ul className="divide-y divide-line">
            {m.events.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-body-sm">
                <span className="min-w-0">
                  {e.title}
                  <span className="block text-caption text-ink-secondary">{formatDate(e.startAt)}</span>
                </span>
                <Badge tone={EVENT_STATUS_BADGE[e.status].tone}>{EVENT_STATUS_BADGE[e.status].label}</Badge>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="history" className="card space-y-3 p-5">
        <h2 id="history" className="text-title">
          Decision history
        </h2>
        {m.history.length === 0 ? (
          <p className="text-body-sm text-ink-secondary">No decisions recorded yet.</p>
        ) : (
          <ol className="space-y-3">
            {m.history.map((h) => (
              <li key={h.createdAt + h.action} className="text-body-sm">
                <span className="font-medium">{ACTION_LABEL[h.action] ?? h.action}</span> by {h.actor ?? 'system'}
                <span className="block text-caption text-ink-secondary">
                  {formatDateTime(h.createdAt)}
                  {h.metadata?.from && ` · was ${h.metadata.from.toLowerCase()}`}
                </span>
                {h.metadata?.reason && <span className="block text-caption">{h.metadata.reason}</span>}
              </li>
            ))}
          </ol>
        )}
      </section>
    </>
  );
}
