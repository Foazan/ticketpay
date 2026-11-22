import { formatRupiah } from '@ticketpay/shared';
import type { Metadata } from 'next';
import { PageHeader } from '@/components/organizer/page-header';
import { StatusBadge } from '@/components/organizer/status-badges';
import { DataTable, Td, Th } from '@/components/organizer/table';
import { Button } from '@/components/ui';
import { serverFetch } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import type { OrganizerEventRow, Transaction } from '@/lib/organizer';
import { cookieHeader } from '@/lib/session';

export const metadata: Metadata = { title: 'Transactions' };

const STATUSES = ['PAID', 'PENDING', 'FAILED', 'EXPIRED', 'REFUNDED'];

export default async function Transactions({ searchParams }: { searchParams: Promise<{ status?: string; eventId?: string }> }) {
  const { status = '', eventId = '' } = await searchParams;
  const cookies = await cookieHeader();
  const qs = new URLSearchParams({ ...(status ? { status } : {}), ...(eventId ? { eventId } : {}) }).toString();
  const [rows, events] = await Promise.all([
    serverFetch<Transaction[]>(`/v1/organizer/transactions${qs ? `?${qs}` : ''}`, cookies),
    serverFetch<OrganizerEventRow[]>('/v1/organizer/events', cookies),
  ]);
  return (
    <>
      <PageHeader title="Transactions" intro="Every order for your events, with the payment provider's status next to TicketPay's own and whether the tickets were issued. Latest 200." />
      <form className="flex flex-wrap items-end gap-3" method="get">
        <div>
          <label htmlFor="status" className="field-label">
            Status
          </label>
          <select id="status" name="status" defaultValue={status} className="field">
            <option value="">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.charAt(0) + s.slice(1).toLowerCase()}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="eventId" className="field-label">
            Event
          </label>
          <select id="eventId" name="eventId" defaultValue={eventId} className="field">
            <option value="">All events</option>
            {events.map((e) => (
              <option key={e.id} value={e.id}>
                {e.title}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" variant="secondary">
          Apply
        </Button>
      </form>
      <DataTable
        caption="Transactions"
        head={
          <>
            <Th>Order</Th>
            <Th>Buyer</Th>
            <Th>Event and tickets</Th>
            <Th right>Amount</Th>
            <Th>Provider status</Th>
            <Th>TicketPay status</Th>
            <Th>Tickets issued</Th>
            <Th>Date</Th>
          </>
        }
        empty={rows.length === 0 && <p className="p-6 text-body-sm text-ink-secondary">No transactions match these filters.</p>}
      >
        {rows.map((t) => (
          <tr key={t.orderId}>
            <Td>
              <span className="font-mono text-caption">{t.orderNumber}</span>
              {t.paymentReference && <span className="block font-mono text-caption text-ink-muted">{t.paymentReference}</span>}
            </Td>
            <Td>{t.buyerName}</Td>
            <Td>
              {t.event}
              <span className="block text-caption text-ink-secondary">{t.ticketTypes ?? '—'}</span>
            </Td>
            <Td right>
              {formatRupiah(t.total)}
              <span className="block text-caption text-ink-muted">incl. {formatRupiah(t.serviceFee)} fee</span>
            </Td>
            <Td>
              <span className="font-mono text-caption">{t.providerStatus ?? '—'}</span>
              {t.provider && <span className="block text-caption text-ink-muted">{t.provider === 'MOCK' ? 'Demo' : 'Midtrans'}{t.method ? ` · ${t.method}` : ''}</span>}
            </Td>
            <Td>
              <StatusBadge status={t.paymentStatus ?? t.orderStatus} />
            </Td>
            <Td>
              {t.orderStatus === 'PAID' ? (
                <>
                  {t.ticketsIssued} of {t.quantity}
                  <span className="block text-caption text-ink-muted">{t.ticketsMinted} minted</span>
                </>
              ) : (
                <span className="text-ink-muted">—</span>
              )}
            </Td>
            <Td>{formatDateTime(t.createdAt)}</Td>
          </tr>
        ))}
      </DataTable>
    </>
  );
}
