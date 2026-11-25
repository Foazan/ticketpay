import type { Metadata } from 'next';
import Link from 'next/link';
import { AdminAction } from '@/components/admin/actions';
import { FilterTabs } from '@/components/admin/filter-tabs';
import { Meter } from '@/components/organizer/column-chart';
import { PageHeader } from '@/components/organizer/page-header';
import { DataTable, Td, Th } from '@/components/organizer/table';
import { Badge } from '@/components/ui';
import { serverFetch } from '@/lib/api';
import { MERCHANT_BADGE, query, type AdminEventRow } from '@/lib/admin';
import { formatDate } from '@/lib/format';
import { EVENT_STATUS_BADGE, type EventStatus } from '@/lib/organizer';
import { cookieHeader } from '@/lib/session';

export const metadata: Metadata = { title: 'Events' };

const STATUSES: EventStatus[] = ['PUBLISHED', 'DRAFT', 'UNPUBLISHED', 'ARCHIVED'];

export default async function AdminEvents({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status = '' } = await searchParams;
  const rows = await serverFetch<AdminEventRow[]>(`/v1/admin/events${query({ status })}`, await cookieHeader());
  return (
    <>
      <PageHeader
        title="Events"
        intro="Every organizer's events. Taking an event off sale is for moderation: tickets already sold stay valid, and the organizer can publish again after fixing the issue."
      />
      <FilterTabs base="/admin/events" current={status} options={STATUSES.map((s) => ({ value: s, label: EVENT_STATUS_BADGE[s].label }))} />
      <DataTable
        caption="Events"
        head={
          <>
            <Th>Event</Th>
            <Th>Organizer</Th>
            <Th>Status</Th>
            <Th>Sold</Th>
            <Th right>Gate staff</Th>
            <Th>Moderation</Th>
          </>
        }
        empty={rows.length === 0 && <p className="p-6 text-body-sm text-ink-secondary">No events with this status.</p>}
      >
        {rows.map((e) => (
          <tr key={e.id}>
            <Td>
              {e.status === 'PUBLISHED' && e.merchantStatus === 'APPROVED' ? (
                <Link href={`/events/${e.slug}`} className="font-medium text-ink-accent underline-offset-2 hover:underline">
                  {e.title}
                </Link>
              ) : (
                <span className="font-medium">{e.title}</span>
              )}
              <span className="block text-caption text-ink-secondary">
                {e.city} · {formatDate(e.startAt)}
              </span>
            </Td>
            <Td>
              <Link href={`/admin/merchants/${e.merchantId}`} className="text-ink-accent underline-offset-2 hover:underline">
                {e.merchant}
              </Link>
              {e.merchantStatus !== 'APPROVED' && <span className="block text-caption text-status-danger">{MERCHANT_BADGE[e.merchantStatus].label}: hidden from buyers</span>}
            </Td>
            <Td>
              <Badge tone={EVENT_STATUS_BADGE[e.status].tone}>{EVENT_STATUS_BADGE[e.status].label}</Badge>
            </Td>
            <Td>
              <div className="w-56">
                <Meter value={e.sold} max={e.quota} label={`${e.sold.toLocaleString('id-ID')} of ${e.quota.toLocaleString('id-ID')}`} />
              </div>
            </Td>
            <Td right>{e.gateStaff}</Td>
            <Td>
              {e.status === 'PUBLISHED' ? (
                <AdminAction
                  label="Take off sale"
                  small
                  path={`/v1/admin/events/${e.id}/unpublish`}
                  reason={{ label: 'Reason', hint: 'Kept in the audit log. Tell the organizer what to fix.', required: true }}
                />
              ) : (
                <span className="text-caption text-ink-muted">—</span>
              )}
            </Td>
          </tr>
        ))}
      </DataTable>
    </>
  );
}
