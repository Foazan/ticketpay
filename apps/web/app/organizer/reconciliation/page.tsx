import { formatRupiah } from '@ticketpay/shared';
import type { Metadata } from 'next';
import { PageHeader, Stat } from '@/components/organizer/page-header';
import { DataTable, Td, Th } from '@/components/organizer/table';
import { Badge } from '@/components/ui';
import { serverFetch } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import type { Reconciliation, ReconRow } from '@/lib/organizer';
import { cookieHeader } from '@/lib/session';

export const metadata: Metadata = { title: 'Reconciliation' };

const STATUS: Record<ReconRow['status'], { label: string; tone: 'success' | 'pending' | 'failed' | 'info' }> = {
  MATCHED: { label: 'Matched', tone: 'success' },
  PENDING: { label: 'Pending', tone: 'pending' },
  MISMATCH: { label: 'Mismatch', tone: 'failed' },
  INVESTIGATE: { label: 'Requires investigation', tone: 'failed' },
};

const ORDER: ReconRow['status'][] = ['INVESTIGATE', 'MISMATCH', 'PENDING', 'MATCHED'];

export default async function ReconciliationPage() {
  const r = await serverFetch<Reconciliation>('/v1/organizer/reconciliation', await cookieHeader());
  const rows = [...r.rows].sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status));
  return (
    <>
      <PageHeader
        title="Reconciliation"
        intro="For each payment, the provider's status is compared with TicketPay's payment and ledger records and with ticket issuance on the blockchain. Computed live from the records; no settlement data is invented."
      />
      <dl className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {ORDER.map((s) => (
          <Stat key={s} label={STATUS[s].label} value={r.summary[s].toLocaleString('id-ID')} />
        ))}
      </dl>
      {!r.chainEnabled && <p className="rounded-md bg-bg-muted p-4 text-body-sm text-ink-secondary">The blockchain is off in this environment, so on-chain issuance is not compared.</p>}
      <DataTable
        caption="Reconciliation by payment"
        head={
          <>
            <Th>Result</Th>
            <Th>Payment</Th>
            <Th>Provider</Th>
            <Th>TicketPay</Th>
            <Th>Ledger</Th>
            <Th>Tickets</Th>
            <Th>Findings</Th>
          </>
        }
        empty={rows.length === 0 && <p className="p-6 text-body-sm text-ink-secondary">No payments yet.</p>}
      >
        {rows.map((x) => (
          <tr key={x.paymentId}>
            <Td>
              <Badge tone={STATUS[x.status].tone}>{STATUS[x.status].label}</Badge>
            </Td>
            <Td>
              <span className="font-mono text-caption">{x.reference}</span>
              <span className="block text-caption text-ink-secondary">
                {x.eventTitle} · {formatRupiah(x.amount)}
              </span>
              <span className="block text-caption text-ink-muted">{formatDateTime(x.createdAt)}</span>
            </Td>
            <Td mono>{x.providerStatus ?? '—'}</Td>
            <Td>
              {x.paymentStatus}
              {x.orderStatus !== x.paymentStatus && <span className="block text-caption text-ink-muted">order {x.orderStatus}</span>}
            </Td>
            <Td>
              {x.ledger.gross == null ? (
                <span className="text-ink-muted">none</span>
              ) : (
                <>
                  {formatRupiah(x.ledger.gross)}
                  <span className="block text-caption text-ink-muted">
                    fee {formatRupiah(x.ledger.serviceFee ?? 0)} · net {formatRupiah(x.ledger.merchantNet ?? 0)}
                  </span>
                </>
              )}
            </Td>
            <Td>
              {x.tickets.issued} of {x.tickets.expected} issued
              {r.chainEnabled && x.tickets.issued > 0 && <span className="block text-caption text-ink-muted">{x.tickets.minted} minted</span>}
            </Td>
            <Td>
              {x.findings.length === 0 ? (
                <span className="text-ink-muted">All records agree</span>
              ) : (
                <ul className="list-disc space-y-1 pl-4 text-caption">
                  {x.findings.map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
              )}
            </Td>
          </tr>
        ))}
      </DataTable>
    </>
  );
}
