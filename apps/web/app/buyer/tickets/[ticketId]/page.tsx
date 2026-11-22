import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { AutoRefresh } from '@/components/auto-refresh';
import { TicketQr } from '@/components/ticket-qr';
import { Badge } from '@/components/ui';
import { ApiError, serverFetch } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { requireRole } from '@/lib/require-role';
import { cookieHeader } from '@/lib/session';
import { mintBadge, redeemLabel, shortHex, ticketStatusBadge, type TicketDetail } from '@/lib/tickets';

export const metadata: Metadata = { title: 'Ticket' };
export const dynamic = 'force-dynamic';

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[9rem_1fr] gap-3 py-2">
      <dt className="text-body-sm text-ink-secondary">{label}</dt>
      <dd className="min-w-0 break-words text-body-sm">{children}</dd>
    </div>
  );
}

function Hex({ value, href }: { value: string; href: string | null }) {
  const text = <span className="font-mono" title={value}>{shortHex(value)}</span>;
  return href ? (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-ink-accent underline-offset-2 hover:underline">
      {text} <span aria-hidden>↗</span>
      <span className="sr-only"> (opens Etherscan)</span>
    </a>
  ) : (
    text
  );
}

export default async function TicketPage({ params }: { params: Promise<{ ticketId: string }> }) {
  const { ticketId } = await params;
  await requireRole('BUYER', `/buyer/tickets/${ticketId}`);
  let t: TicketDetail;
  try {
    t = await serverFetch<TicketDetail>(`/v1/tickets/${encodeURIComponent(ticketId)}`, await cookieHeader());
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) notFound();
    throw err;
  }
  const badge = mintBadge(t);
  const status = ticketStatusBadge(t);
  const usable = status.label === 'Active';
  const redeem = redeemLabel(t.chain.redeemStatus);
  const inFlight =
    t.chain.enabled &&
    t.status !== 'CANCELLED' &&
    (t.mintStatus === 'PENDING' || t.mintStatus === 'SUBMITTED' || t.chain.redeemStatus === 'PENDING');

  return (
    <div className="container-page max-w-3xl space-y-6 py-12">
      <AutoRefresh active={inFlight} />
      <Link href="/buyer/tickets" className="text-body-sm text-ink-accent hover:underline">
        ← My Tickets
      </Link>

      <section className="card grid overflow-hidden shadow-card md:grid-cols-[17rem_1fr] md:gap-2 md:p-6">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={t.posterPath} alt="" className="aspect-[8/5] w-full object-cover md:rounded-md" />
        <div className="space-y-2 p-6 md:row-span-2 md:py-0 md:pr-0">
          <h1 className="text-h2">{t.eventTitle}</h1>
          <p className="text-body-sm text-ink-secondary">{formatDateTime(t.eventStartAt)}</p>
          <p className="text-body-sm text-ink-secondary">
            {t.venue}, {t.city}
          </p>
          <p className="flex flex-wrap gap-2 pt-1">
            <Badge>{t.tierName}</Badge>
            <Badge tone={status.tone}>{status.label}</Badge>
          </p>
          <dl className="divide-y divide-line pt-2">
            <Row label="Holder">{t.holderName}</Row>
            <Row label="Ticket number">#{t.seq} in this order</Row>
            {t.redeemedAt && <Row label="Used at the gate">{formatDateTime(t.redeemedAt)}</Row>}
          </dl>
          {usable ? (
            <p className="rounded-md bg-bg-muted p-4 text-body-sm text-ink-secondary">
              Show the QR at the gate. It changes every 30 seconds and works only once, so a screenshot or forwarded photo will not get anyone in. Turn your screen brightness up.
            </p>
          ) : (
            <p className="rounded-md bg-bg-muted p-4 text-body-sm text-ink-secondary">
              {t.status === 'REDEEMED'
                ? 'This ticket was used to enter the event. It has no entry code any more.'
                : t.status === 'CANCELLED'
                  ? 'This ticket was cancelled. It cannot be used for entry.'
                  : 'This event has ended.'}
            </p>
          )}
        </div>
        {usable && (
          // Under the poster on wide screens, after the details on phones. One instance only: each copy would issue its own codes.
          <div className="px-6 pb-6 md:col-start-1 md:row-start-2 md:p-0 md:pt-4">
            <TicketQr ticketId={t.id} validationCode={t.validationCode} />
          </div>
        )}
      </section>

      <section className="card space-y-3 p-6 shadow-card" aria-labelledby="chain-heading">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="chain-heading" className="text-title">
            Ownership record
          </h2>
          <Badge tone={badge.tone}>{badge.label}</Badge>
        </div>

        {!t.chain.enabled ? (
          <p className="text-body-sm text-ink-secondary">This environment issues tickets off-chain only. Your ticket is valid; no blockchain record is created here.</p>
        ) : t.mintStatus !== 'MINTED' ? (
          <p className="text-body-sm text-ink-secondary" role="status">
            {t.mintStatus === 'FAILED'
              ? 'Recording this ticket on-chain is taking longer than usual. It is retried automatically. Your ticket is valid either way.'
              : 'Your payment is verified and your ticket is valid. Its NFT record is being written to the blockchain; this page updates by itself.'}
          </p>
        ) : (
          <>
            <p className="text-body-sm text-ink-secondary">
              This ticket is an ERC-721 token on the {t.chain.network}. It is held for you by TicketPay in a custodial address and cannot be transferred or resold.
            </p>
            <dl className="divide-y divide-line">
              <Row label="Token ID">
                {t.chain.tokenUrl ? (
                  <a href={t.chain.tokenUrl} target="_blank" rel="noopener noreferrer" className="text-ink-accent hover:underline">
                    #{t.tokenId} <span aria-hidden>↗</span>
                  </a>
                ) : (
                  <>#{t.tokenId}</>
                )}
              </Row>
              <Row label="Network">
                {t.chain.network}
                {t.chain.chainId ? ` (chain ${t.chain.chainId})` : ''}
              </Row>
              {t.chain.contractAddress && (
                <Row label="Contract">
                  <Hex value={t.chain.contractAddress} href={t.chain.contractUrl} />
                </Row>
              )}
              {t.chain.txHash && (
                <Row label="Mint transaction">
                  <Hex value={t.chain.txHash} href={t.chain.txUrl} />
                </Row>
              )}
              {t.chain.ownerAddress && (
                <Row label="Held at">
                  <Hex value={t.chain.ownerAddress} href={null} />
                </Row>
              )}
              {redeem && (
                <Row label="Gate redemption">
                  {redeem}
                  {t.chain.redeemTxHash && (
                    <span className="block">
                      <Hex value={t.chain.redeemTxHash} href={t.chain.redeemTxUrl} />
                    </span>
                  )}
                </Row>
              )}
              <Row label="Payment reference">
                <Hex value={t.paymentRefHash} href={null} />
                <span className="block text-caption text-ink-secondary">A one-way hash. No personal or payment details are stored on-chain.</span>
              </Row>
            </dl>
            {t.chain.chainId === 11155111 && <p className="text-caption text-ink-secondary">Sepolia is an Ethereum test network. The token has no monetary value.</p>}
          </>
        )}
      </section>
    </div>
  );
}
