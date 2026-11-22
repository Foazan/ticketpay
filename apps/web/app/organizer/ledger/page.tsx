import { formatRupiah } from '@ticketpay/shared';
import type { Metadata } from 'next';
import { PageHeader, Stat } from '@/components/organizer/page-header';
import { DataTable, Td, Th } from '@/components/organizer/table';
import { serverFetch } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import type { LedgerEntry } from '@/lib/organizer';
import { cookieHeader } from '@/lib/session';

export const metadata: Metadata = { title: 'Ledger' };

const TYPE: Record<string, string> = {
  GROSS_SALE: 'Gross sale',
  SERVICE_FEE: 'Service fee',
  PROVIDER_FEE: 'Provider fee',
  MERCHANT_NET: 'Organizer net (estimate)',
  REFUND: 'Refund',
  ADJUSTMENT: 'Adjustment',
};

export default async function Ledger() {
  const rows = await serverFetch<LedgerEntry[]>('/v1/organizer/ledger', await cookieHeader());
  const sum = (type: string) => rows.filter((r) => r.type === type).reduce((s, r) => s + (r.direction === 'CREDIT' ? r.amount : r.amount), 0);
  return (
    <>
      <PageHeader
        title="Ledger"
        intro="An append-only record of every money movement on your payments. Entries are never edited; a correction is a new adjustment line. Balances here are internal estimates from sandbox payments, not settled funds."
      />
      <dl className="grid gap-4 sm:grid-cols-3">
        <Stat label="Gross sales" value={formatRupiah(sum('GROSS_SALE'))} />
        <Stat label="Service fees" value={formatRupiah(sum('SERVICE_FEE'))} />
        <Stat label="Organizer net (estimate)" value={formatRupiah(sum('MERCHANT_NET'))} />
      </dl>
      <DataTable
        caption="Ledger entries"
        head={
          <>
            <Th>Date</Th>
            <Th>Entry</Th>
            <Th>Payment</Th>
            <Th right>Credit</Th>
            <Th right>Debit</Th>
          </>
        }
        empty={rows.length === 0 && <p className="p-6 text-body-sm text-ink-secondary">No ledger entries yet. They are written when a payment is verified as paid.</p>}
      >
        {rows.map((r) => (
          <tr key={r.id}>
            <Td>{formatDateTime(r.createdAt)}</Td>
            <Td>
              {TYPE[r.type] ?? r.type}
              <span className="block text-caption text-ink-secondary">{r.description}</span>
            </Td>
            <Td mono>{r.paymentReference}</Td>
            <Td right>{r.direction === 'CREDIT' ? formatRupiah(r.amount) : ''}</Td>
            <Td right>{r.direction === 'DEBIT' ? formatRupiah(r.amount) : ''}</Td>
          </tr>
        ))}
      </DataTable>
    </>
  );
}
