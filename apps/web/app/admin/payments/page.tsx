import { formatRupiah } from '@ticketpay/shared';
import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader } from '@/components/organizer/page-header';
import { StatusBadge } from '@/components/organizer/status-badges';
import { DataTable, Td, Th } from '@/components/organizer/table';
import { Button } from '@/components/ui';
import { serverFetch } from '@/lib/api';
import { query, type AdminMerchantRow, type AdminPaymentRow } from '@/lib/admin';
import { formatDateTime } from '@/lib/format';
import { cookieHeader } from '@/lib/session';

export const metadata: Metadata = { title: 'Payments' };

const STATUSES = ['PAID', 'PENDING', 'FAILED', 'EXPIRED', 'REFUNDED'];

export default async function AdminPayments({ searchParams }: { searchParams: Promise<{ status?: string; merchantId?: string; q?: string }> }) {
  const { status = '', merchantId = '', q = '' } = await searchParams;
  const cookies = await cookieHeader();
  const [rows, merchants] = await Promise.all([
    serverFetch<AdminPaymentRow[]>(`/v1/admin/payments${query({ status, merchantId, q })}`, cookies),
    serverFetch<AdminMerchantRow[]>('/v1/admin/merchants', cookies),
  ]);
  return (
    <>
      <PageHeader title="Payments" intro="Every payment across organizers, with the provider's last status next to TicketPay's. Open one to see its notifications, ledger lines, tickets and webhooks. Latest 200." />
      <form className="flex flex-wrap items-end gap-3" method="get">
        <div className="min-w-0 flex-1 sm:flex-none">
          <label htmlFor="q" className="field-label">
            Search
          </label>
          <input id="q" name="q" defaultValue={q} className="field" placeholder="Reference, order or buyer" />
        </div>
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
        <div className="min-w-0">
          <label htmlFor="merchantId" className="field-label">
            Organizer
          </label>
          <select id="merchantId" name="merchantId" defaultValue={merchantId} className="field">
            <option value="">All organizers</option>
            {merchants.map((m) => (
              <option key={m.id} value={m.id}>
                {m.businessName}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" variant="secondary">
          Apply
        </Button>
      </form>
      <DataTable
        caption="Payments"
        head={
          <>
            <Th>Payment</Th>
            <Th>Buyer and event</Th>
            <Th>Organizer</Th>
            <Th right>Amount</Th>
            <Th>Method</Th>
            <Th>Provider</Th>
            <Th>TicketPay</Th>
          </>
        }
        empty={rows.length === 0 && <p className="p-6 text-body-sm text-ink-secondary">No payments match.</p>}
      >
        {rows.map((p) => (
          <tr key={p.id}>
            <Td>
              <Link href={`/admin/payments/${p.id}`} className="font-mono text-caption text-ink-accent underline-offset-2 hover:underline">
                {p.reference}
              </Link>
              <span className="block text-caption text-ink-muted">{formatDateTime(p.createdAt)}</span>
            </Td>
            <Td>
              {p.buyerName}
              <span className="block text-caption text-ink-secondary">{p.event}</span>
            </Td>
            <Td>{p.merchant}</Td>
            <Td right>{formatRupiah(p.amount)}</Td>
            <Td>{p.method ?? '—'}</Td>
            <Td mono>
              {p.provider}
              <span className="block">{p.providerStatus ?? '—'}</span>
            </Td>
            <Td>
              <StatusBadge status={p.status} />
            </Td>
          </tr>
        ))}
      </DataTable>
    </>
  );
}
