import type { Metadata } from 'next';
import Link from 'next/link';
import { AdminAction } from '@/components/admin/actions';
import { FilterTabs } from '@/components/admin/filter-tabs';
import { PageHeader } from '@/components/organizer/page-header';
import { DataTable, Td, Th } from '@/components/organizer/table';
import { Badge } from '@/components/ui';
import { serverFetch } from '@/lib/api';
import { DELIVERY_BADGE, query, type WebhookDelivery } from '@/lib/admin';
import { formatDateTime } from '@/lib/format';
import { cookieHeader } from '@/lib/session';

export const metadata: Metadata = { title: 'Merchant webhooks' };

const STATUSES = ['FAILED', 'RETRYING', 'PENDING', 'DELIVERED'] as const;

export default async function WebhooksPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status = '' } = await searchParams;
  const rows = await serverFetch<WebhookDelivery[]>(`/v1/admin/webhooks${query({ status })}`, await cookieHeader());
  return (
    <>
      <PageHeader
        title="Merchant webhooks"
        intro="Signed notifications TicketPay sends to organizers' systems. Failed attempts are retried automatically with backoff; a delivery that gave up can be sent again here with the same event id, so the organizer can ignore duplicates. Latest 200."
      />
      <FilterTabs base="/admin/webhooks" current={status} options={STATUSES.map((s) => ({ value: s, label: DELIVERY_BADGE[s].label }))} />
      <DataTable
        caption="Webhook deliveries"
        head={
          <>
            <Th>Event</Th>
            <Th>Organizer</Th>
            <Th>Payment</Th>
            <Th>Status</Th>
            <Th>Attempts</Th>
            <Th>Action</Th>
          </>
        }
        empty={rows.length === 0 && <p className="p-6 text-body-sm text-ink-secondary">No deliveries with this status.</p>}
      >
        {rows.map((d) => (
          <tr key={d.id}>
            <Td>
              <span className="font-mono text-caption">{d.eventType}</span>
              <span className="block font-mono text-caption text-ink-muted">{d.eventId}</span>
              <span className="block text-caption text-ink-muted">{formatDateTime(d.createdAt)}</span>
            </Td>
            <Td>{d.merchant}</Td>
            <Td>
              <Link href={`/admin/payments/${d.paymentId}`} className="font-mono text-caption text-ink-accent underline-offset-2 hover:underline">
                {d.paymentReference}
              </Link>
            </Td>
            <Td>
              <Badge tone={DELIVERY_BADGE[d.status].tone}>{DELIVERY_BADGE[d.status].label}</Badge>
              {d.status === 'RETRYING' && d.nextAttemptAt && <span className="block text-caption text-ink-muted">next {formatDateTime(d.nextAttemptAt)}</span>}
              {d.deliveredAt && <span className="block text-caption text-ink-muted">{formatDateTime(d.deliveredAt)}</span>}
            </Td>
            <Td>
              {d.attemptCount}
              {d.lastStatusCode && <span className="block text-caption text-ink-muted">last HTTP {d.lastStatusCode}</span>}
              {d.lastError && <span className="block max-w-[16rem] text-caption text-status-danger">{d.lastError}</span>}
            </Td>
            <Td>{d.status === 'FAILED' ? <AdminAction label="Retry" small path={`/v1/admin/webhooks/${d.id}/retry`} /> : <span className="text-caption text-ink-muted">—</span>}</Td>
          </tr>
        ))}
      </DataTable>
    </>
  );
}
