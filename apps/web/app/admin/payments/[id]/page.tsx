import { formatRupiah } from '@ticketpay/shared';
import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { AdminAction } from '@/components/admin/actions';
import { PageHeader } from '@/components/organizer/page-header';
import { StatusBadge } from '@/components/organizer/status-badges';
import { Badge } from '@/components/ui';
import { serverFetch } from '@/lib/api';
import { CHAIN_BADGE, DELIVERY_BADGE, percent, shortHash, type AdminPayment } from '@/lib/admin';
import { formatDateTime } from '@/lib/format';
import { cookieHeader } from '@/lib/session';

export const metadata: Metadata = { title: 'Payment' };

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="card min-w-0 space-y-3 p-5">
      <h2 id={id} className="text-title">
        {title}
      </h2>
      {children}
    </section>
  );
}

const Row = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="flex flex-wrap justify-between gap-x-4 gap-y-1 py-1 text-body-sm">
    <dt className="text-ink-secondary">{label}</dt>
    <dd className="min-w-0 break-words text-right">{children}</dd>
  </div>
);

const ticketTone = (s: string) => (s === 'ACTIVE' ? 'success' : s === 'REDEEMED' ? 'info' : 'neutral');

export default async function AdminPaymentDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = await serverFetch<AdminPayment>(`/v1/admin/payments/${id}`, await cookieHeader());
  const { payment: p, order: o } = d;
  const redeemed = d.tickets.some((t) => t.status === 'REDEEMED');
  return (
    <>
      <p className="text-caption">
        <Link href="/admin/payments" className="text-ink-accent">
          Payments
        </Link>{' '}
        / <span className="font-mono">{p.reference}</span>
      </p>
      <PageHeader title={formatRupiah(p.amount)} intro={`${d.event} · ${d.merchant}`} actions={<StatusBadge status={p.status} />} />

      {p.status === 'PAID' && (
        <Section id="refund" title="Refund">
          {d.canRefund ? (
            <>
              <p className="text-body-sm text-ink-secondary">
                A simulated refund: no money moves and the payment provider is not called. The order&apos;s tickets are cancelled (and their NFTs cancelled on-chain), the quota is released, the
                ledger is reversed and the organizer receives a <span className="font-mono">payment.refunded</span> webhook.
              </p>
              <AdminAction
                label="Refund (simulated)"
                busyLabel="Refunding…"
                variant="danger"
                path={`/v1/payments/${p.id}/refund`}
                confirm={`Refund ${formatRupiah(p.amount)} to ${o.buyerName}? This cancels ${d.tickets.length} ticket(s) and cannot be undone.`}
                reason={{ label: 'Reason for the refund', hint: 'Kept in the audit log.', required: true }}
              />
            </>
          ) : (
            <p className="text-body-sm text-ink-secondary">{redeemed ? 'Not available: a ticket from this order has already been admitted at the gate.' : 'Not available for this payment.'}</p>
          )}
        </Section>
      )}

      <div className="grid gap-6 xl:grid-cols-2">
        <Section id="payment" title="Payment">
          <dl className="divide-y divide-line">
            <Row label="Reference">
              <span className="font-mono text-caption">{p.reference}</span>
            </Row>
            <Row label="Provider">
              {p.provider}
              {p.providerTransactionId && <span className="block font-mono text-caption">{p.providerTransactionId}</span>}
            </Row>
            <Row label="Provider status">
              <span className="font-mono text-caption">{p.providerStatus ?? '—'}</span>
            </Row>
            <Row label="Method">{p.method ?? '—'}</Row>
            <Row label="Created">{formatDateTime(p.createdAt)}</Row>
            <Row label="Paid">{p.paidAt ? formatDateTime(p.paidAt) : '—'}</Row>
          </dl>
        </Section>
        <Section id="order" title="Order">
          <dl className="divide-y divide-line">
            <Row label="Order number">
              <span className="font-mono text-caption">{o.orderNumber}</span>
            </Row>
            <Row label="Buyer">{o.buyerName}</Row>
            {d.items.map((i) => (
              <Row key={i.tier} label={`${i.tier} × ${i.quantity}`}>
                {formatRupiah(i.unitPrice * i.quantity)}
              </Row>
            ))}
            <Row label={`Service fee (${percent(o.feeRateBps)})`}>{formatRupiah(o.serviceFee)}</Row>
            <Row label="Total">{formatRupiah(o.total)}</Row>
            <Row label="Order status">
              <StatusBadge status={o.status} />
            </Row>
          </dl>
        </Section>
      </div>

      <Section id="notifications" title="Provider notifications">
        {d.notifications.length === 0 ? (
          <p className="text-body-sm text-ink-secondary">None received yet.</p>
        ) : (
          <ul className="divide-y divide-line text-body-sm">
            {d.notifications.map((n) => (
              <li key={n.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="min-w-0">
                  <span className="font-mono text-caption">{n.providerStatus ?? '—'}</span> from {n.source}
                  <span className="block text-caption text-ink-muted">{formatDateTime(n.receivedAt)}</span>
                </span>
                <span className="flex flex-wrap gap-2">
                  {n.source === 'MIDTRANS' ? (
                    <Badge tone={n.signatureValid ? 'success' : 'failed'}>{n.signatureValid ? 'Signature valid' : 'Signature invalid'}</Badge>
                  ) : (
                    <Badge tone="neutral">{n.source === 'ADMIN' ? 'Administrator action' : n.source === 'SYSTEM' ? 'TicketPay system' : 'Demo provider'}</Badge>
                  )}
                  <Badge tone={n.outcome === 'APPLIED' ? 'info' : 'neutral'}>{n.outcome.toLowerCase()}</Badge>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section id="ledger" title="Ledger lines">
        {d.ledger.length === 0 ? (
          <p className="text-body-sm text-ink-secondary">No ledger lines: the payment was never verified as paid.</p>
        ) : (
          <ul className="divide-y divide-line text-body-sm">
            {d.ledger.map((l) => (
              <li key={l.id} className="flex flex-wrap justify-between gap-2 py-2">
                <span className="min-w-0">
                  <span className="font-mono text-caption">{l.type}</span> · {l.direction.toLowerCase()}
                  <span className="block text-caption text-ink-secondary">{l.description}</span>
                </span>
                <span className="tabular-nums">{formatRupiah(l.amount)}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section id="tickets" title={`Tickets (${d.tickets.length})`}>
        {d.tickets.length === 0 ? (
          <p className="text-body-sm text-ink-secondary">No tickets issued.</p>
        ) : (
          <ul className="divide-y divide-line text-body-sm">
            {d.tickets.map((t) => (
              <li key={t.id} className="space-y-1 py-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span>
                    Ticket {t.seq}
                    {t.tokenId && <span className="text-ink-secondary"> · token #{t.tokenId}</span>}
                  </span>
                  <span className="flex flex-wrap gap-2">
                    <Badge tone={ticketTone(t.status)}>{t.status.toLowerCase()}</Badge>
                    <Badge tone={CHAIN_BADGE[t.mintStatus]?.tone ?? 'neutral'}>mint {t.mintStatus.toLowerCase()}</Badge>
                  </span>
                </div>
                {t.chain.map((c, i) => (
                  <p key={i} className="text-caption text-ink-secondary">
                    {c.type.toLowerCase()} {c.status.toLowerCase()}
                    {c.txHash &&
                      (c.txUrl ? (
                        <>
                          {' · '}
                          <a href={c.txUrl} target="_blank" rel="noreferrer" className="font-mono text-ink-accent">
                            {shortHash(c.txHash)}
                          </a>
                        </>
                      ) : (
                        <span className="font-mono"> · {shortHash(c.txHash)}</span>
                      ))}
                    {c.errorMessage && c.status === 'FAILED' && <span className="block">{c.errorMessage}</span>}
                  </p>
                ))}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section id="deliveries" title="Merchant webhooks">
        {d.deliveries.length === 0 ? (
          <p className="text-body-sm text-ink-secondary">No webhooks sent for this payment.</p>
        ) : (
          <ul className="divide-y divide-line text-body-sm">
            {d.deliveries.map((w) => (
              <li key={w.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="min-w-0">
                  <span className="font-mono text-caption">{w.eventType}</span>
                  <span className="block text-caption text-ink-muted">
                    {w.attemptCount} attempt(s){w.lastStatusCode ? ` · last HTTP ${w.lastStatusCode}` : ''}
                    {w.lastError ? ` · ${w.lastError}` : ''}
                  </span>
                </span>
                <span className="flex flex-wrap items-center gap-2">
                  <Badge tone={DELIVERY_BADGE[w.status as keyof typeof DELIVERY_BADGE]?.tone ?? 'neutral'}>{DELIVERY_BADGE[w.status as keyof typeof DELIVERY_BADGE]?.label ?? w.status}</Badge>
                  {w.status === 'FAILED' && <AdminAction label="Retry" small path={`/v1/admin/webhooks/${w.id}/retry`} />}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  );
}
