import type { Metadata } from 'next';
import { FeeForm } from '@/components/admin/actions';
import { PageHeader, Stat } from '@/components/organizer/page-header';
import { DataTable, Td, Th } from '@/components/organizer/table';
import { serverFetch } from '@/lib/api';
import { percent, type FeeSettings } from '@/lib/admin';
import { formatDateTime } from '@/lib/format';
import { cookieHeader } from '@/lib/session';

export const metadata: Metadata = { title: 'Service fee' };

export default async function FeesPage() {
  const f = await serverFetch<FeeSettings>('/v1/admin/fees', await cookieHeader());
  return (
    <>
      <PageHeader
        title="Service fee"
        intro="TicketPay's platform fee, charged to the buyer as a percentage of the ticket subtotal (an illustrative rate for this prototype). Each order keeps the rate it was quoted, so a change never alters orders already created."
      />
      <dl className="grid max-w-xl gap-4 sm:grid-cols-2">
        <Stat label="Current rate" value={percent(f.currentRateBps)} note={`${f.currentRateBps} basis points`} />
        <Stat label="On a Rp 100.000 ticket" value={`Rp ${Math.round((100000 * f.currentRateBps) / 10000).toLocaleString('id-ID')}`} />
      </dl>
      <FeeForm currentBps={f.currentRateBps} />
      <DataTable
        caption="Rate history"
        head={
          <>
            <Th>Effective from</Th>
            <Th right>Rate</Th>
            <Th>Set by</Th>
            <Th>Note</Th>
          </>
        }
        empty={f.history.length === 0 && <p className="p-6 text-body-sm text-ink-secondary">The default rate from the configuration applies; no change recorded yet.</p>}
      >
        {f.history.map((h) => (
          <tr key={h.id}>
            <Td>{formatDateTime(h.effectiveFrom)}</Td>
            <Td right>{percent(h.feeRateBps)}</Td>
            <Td>{h.setBy ?? 'Seed data'}</Td>
            <Td>{h.note ?? '—'}</Td>
          </tr>
        ))}
      </DataTable>
    </>
  );
}
