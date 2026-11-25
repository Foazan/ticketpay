import { formatRupiah } from '@ticketpay/shared';
import Link from 'next/link';
import { formatDateTime } from '@/lib/format';
import type { Reconciliation, ReconRow } from '@/lib/organizer';
import { Badge } from '../ui';
import { Stat } from './page-header';
import { DataTable, Td, Th } from './table';

export const RECON_STATUS: Record<ReconRow['status'], { label: string; tone: 'success' | 'pending' | 'failed' | 'info' }> = {
  MATCHED: { label: 'Matched', tone: 'success' },
  PENDING: { label: 'Pending', tone: 'pending' },
  MISMATCH: { label: 'Mismatch', tone: 'failed' },
  INVESTIGATE: { label: 'Requires investigation', tone: 'failed' },
};

export const RECON_ORDER: ReconRow['status'][] = ['INVESTIGATE', 'MISMATCH', 'PENDING', 'MATCHED'];

/**
 * Per-payment comparison of the provider's status, TicketPay's records and the chain.
 * `paymentHref` links each row to a detail page (admin only); `showMerchant` adds the organizer column.
 */
export function ReconView({ report, showMerchant, paymentHref }: { report: Reconciliation; showMerchant?: boolean; paymentHref?: (id: string) => string }) {
  const rows = [...report.rows].sort((a, b) => RECON_ORDER.indexOf(a.status) - RECON_ORDER.indexOf(b.status));
  return (
    <>
      <dl className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {RECON_ORDER.map((s) => (
          <Stat key={s} label={RECON_STATUS[s].label} value={report.summary[s].toLocaleString('id-ID')} />
        ))}
      </dl>
      {!report.chainEnabled && <p className="rounded-md bg-bg-muted p-4 text-body-sm text-ink-secondary">The blockchain is off in this environment, so on-chain issuance is not compared.</p>}
      <DataTable
        caption="Reconciliation by payment"
        head={
          <>
            <Th>Result</Th>
            <Th>Payment</Th>
            {showMerchant && <Th>Organizer</Th>}
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
              <Badge tone={RECON_STATUS[x.status].tone}>{RECON_STATUS[x.status].label}</Badge>
            </Td>
            <Td>
              {paymentHref ? (
                <Link href={paymentHref(x.paymentId)} className="font-mono text-caption text-ink-accent underline-offset-2 hover:underline">
                  {x.reference}
                </Link>
              ) : (
                <span className="font-mono text-caption">{x.reference}</span>
              )}
              <span className="block text-caption text-ink-secondary">
                {x.eventTitle} · {formatRupiah(x.amount)}
              </span>
              <span className="block text-caption text-ink-muted">{formatDateTime(x.createdAt)}</span>
            </Td>
            {showMerchant && <Td>{x.merchant}</Td>}
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
                  {x.ledger.refund != null && <span className="block text-caption text-ink-muted">refund {formatRupiah(x.ledger.refund)}</span>}
                </>
              )}
            </Td>
            <Td>
              {x.tickets.issued} of {x.tickets.expected} issued
              {report.chainEnabled && x.tickets.minted > 0 && <span className="block text-caption text-ink-muted">{x.tickets.minted} minted</span>}
              {report.chainEnabled && x.tickets.refundedMinted > 0 && (
                <span className="block text-caption text-ink-muted">
                  {x.tickets.cancelledOnChain} of {x.tickets.refundedMinted} cancelled on-chain
                </span>
              )}
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
