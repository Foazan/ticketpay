import { formatRupiah } from '@ticketpay/shared';
import type { Metadata } from 'next';
import Link from 'next/link';
import { FilterTabs } from '@/components/admin/filter-tabs';
import { PageHeader, Stat } from '@/components/organizer/page-header';
import { DataTable, Td, Th } from '@/components/organizer/table';
import { serverFetch } from '@/lib/api';
import { query, type AdminLedger } from '@/lib/admin';
import { formatDateTime } from '@/lib/format';
import { cookieHeader } from '@/lib/session';

export const metadata: Metadata = { title: 'Ledger' };

const TYPES = [
  { value: 'GROSS_SALE', label: 'Gross sale' },
  { value: 'SERVICE_FEE', label: 'Service fee' },
  { value: 'MERCHANT_NET', label: 'Organizer net' },
  { value: 'REFUND', label: 'Refund' },
];

/** Positive in the direction that type normally moves (credit for sales and net, debit for fees and refunds). */
const SIGN: Record<string, 'CREDIT' | 'DEBIT'> = { GROSS_SALE: 'CREDIT', MERCHANT_NET: 'CREDIT', SERVICE_FEE: 'DEBIT', REFUND: 'DEBIT' };

export default async function AdminLedgerPage({ searchParams }: { searchParams: Promise<{ type?: string }> }) {
  const { type = '' } = await searchParams;
  const l = await serverFetch<AdminLedger>(`/v1/admin/ledger${query({ type })}`, await cookieHeader());
  const net = (t: string) => {
    const row = l.totals.find((x) => x.type === t);
    if (!row) return 0;
    return SIGN[t] === 'DEBIT' ? row.debit - row.credit : row.credit - row.debit;
  };
  return (
    <>
      <PageHeader
        title="Ledger"
        intro="TicketPay's internal double-entry record for every verified payment, across organizers. Figures are internal estimates for this sandbox prototype, not settled funds."
      />
      {!type && (
        <dl className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Stat label="Gross collected" value={formatRupiah(net('GROSS_SALE'))} />
          <Stat label="Service fees (net of reversals)" value={formatRupiah(net('SERVICE_FEE'))} />
          <Stat label="Organizer net (estimated)" value={formatRupiah(net('MERCHANT_NET'))} />
          <Stat label="Refunds (simulated)" value={formatRupiah(net('REFUND'))} />
        </dl>
      )}
      <FilterTabs base="/admin/ledger" param="type" current={type} options={TYPES} />
      <DataTable
        caption="Ledger entries"
        head={
          <>
            <Th>Date</Th>
            <Th>Organizer</Th>
            <Th>Payment</Th>
            <Th>Type</Th>
            <Th>Description</Th>
            <Th right>Credit</Th>
            <Th right>Debit</Th>
          </>
        }
        empty={l.rows.length === 0 && <p className="p-6 text-body-sm text-ink-secondary">No ledger entries yet.</p>}
      >
        {l.rows.map((r) => (
          <tr key={r.id}>
            <Td>{formatDateTime(r.createdAt)}</Td>
            <Td>{r.merchant}</Td>
            <Td>
              <Link href={`/admin/payments/${r.paymentId}`} className="font-mono text-caption text-ink-accent underline-offset-2 hover:underline">
                {r.paymentReference}
              </Link>
            </Td>
            <Td mono>{r.type}</Td>
            <Td>
              <span className="text-caption text-ink-secondary">{r.description}</span>
            </Td>
            <Td right>{r.direction === 'CREDIT' ? formatRupiah(r.amount) : ''}</Td>
            <Td right>{r.direction === 'DEBIT' ? formatRupiah(r.amount) : ''}</Td>
          </tr>
        ))}
      </DataTable>
      <p className="text-caption text-ink-muted">Latest 300 lines shown; the totals above cover every line.</p>
    </>
  );
}
