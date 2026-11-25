import type { Metadata } from 'next';
import Link from 'next/link';
import { AdminAction } from '@/components/admin/actions';
import { FilterTabs } from '@/components/admin/filter-tabs';
import { PageHeader, Stat } from '@/components/organizer/page-header';
import { DataTable, Td, Th } from '@/components/organizer/table';
import { Badge } from '@/components/ui';
import { serverFetch } from '@/lib/api';
import { CHAIN_BADGE, query, shortHash, type ChainMonitor } from '@/lib/admin';
import { formatDateTime } from '@/lib/format';
import { cookieHeader } from '@/lib/session';

export const metadata: Metadata = { title: 'Blockchain' };

const TYPES = ['MINT', 'REDEEM', 'CANCEL'] as const;
const STATUSES = ['FAILED', 'SUBMITTED', 'QUEUED', 'CONFIRMED'] as const;

export default async function BlockchainPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status = '' } = await searchParams;
  const c = await serverFetch<ChainMonitor>(`/v1/admin/blockchain${query({ status })}`, await cookieHeader());
  const s = c.status;
  const count = (type: string, st: string) => c.counts.find((x) => x.type === type && x.status === st)?.n ?? 0;
  const off = s.mode === 'disabled';
  return (
    <>
      <PageHeader
        title="Blockchain"
        intro="ERC-721 ticket transactions sent by the backend signer after a verified payment (mint), after admission at the gate (redeem) and after a refund (cancel). Every job re-checks the contract first, so a retry never mints or cancels twice."
      />
      <section aria-labelledby="network" className="card space-y-3 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="network" className="text-title">
            {s.network}
          </h2>
          <Badge tone={off ? 'neutral' : s.ready ? 'success' : 'failed'}>{off ? 'Off' : s.ready ? 'Ready' : 'Not ready'}</Badge>
        </div>
        {off ? (
          <p className="text-body-sm text-ink-secondary">CHAIN_MODE is disabled: tickets are issued in the database only. Set CHAIN_MODE to local or sepolia to mint NFTs.</p>
        ) : (
          <dl className="grid gap-2 text-body-sm sm:grid-cols-2">
            <div className="min-w-0">
              <dt className="text-caption text-ink-secondary">Contract</dt>
              <dd className="break-all font-mono text-caption">
                {s.contractUrl ? (
                  <a href={s.contractUrl} target="_blank" rel="noreferrer" className="text-ink-accent">
                    {s.contractAddress}
                  </a>
                ) : (
                  s.contractAddress ?? '—'
                )}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="text-caption text-ink-secondary">Backend signer</dt>
              <dd className="break-all font-mono text-caption">{s.signer ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-caption text-ink-secondary">Chain id</dt>
              <dd>{s.chainId ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-caption text-ink-secondary">Latest block</dt>
              <dd>{s.blockNumber?.toLocaleString('id-ID') ?? '—'}</dd>
            </div>
          </dl>
        )}
        {s.problem && (
          <p role="alert" className="rounded-md bg-status-danger-soft p-3 text-body-sm">
            {s.problem}
          </p>
        )}
      </section>

      <dl className="grid gap-4 sm:grid-cols-3">
        {TYPES.map((t) => (
          <Stat
            key={t}
            label={`${t.charAt(0) + t.slice(1).toLowerCase()} transactions`}
            value={count(t, 'CONFIRMED').toLocaleString('id-ID')}
            note={`confirmed · ${count(t, 'FAILED')} failed · ${count(t, 'SUBMITTED') + count(t, 'QUEUED')} in flight`}
          />
        ))}
      </dl>

      {(c.failedMints.length > 0 || c.failedRedeems.length > 0) && (
        <section aria-labelledby="retry" className="card space-y-3 p-5">
          <h2 id="retry" className="text-title">
            Waiting for a retry
          </h2>
          <p className="text-body-sm text-ink-secondary">These are retried automatically every 10 minutes. Retry now once the cause (an RPC outage, an empty signer wallet) is fixed.</p>
          <ul className="divide-y divide-line text-body-sm">
            {c.failedMints.map((t) => (
              <li key={`m-${t.id}`} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="min-w-0">
                  Mint failed: {t.event}, ticket {t.seq}
                  <span className="block font-mono text-caption text-ink-muted">{t.id}</span>
                </span>
                {!off && <AdminAction label="Retry mint" small path={`/v1/admin/blockchain/tickets/${t.id}/retry`} body={{ action: 'mint' }} />}
              </li>
            ))}
            {c.failedRedeems.map((r) => (
              <li key={`r-${r.ticketId}`} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="min-w-0">
                  Redeem failed: {r.event}, admitted {formatDateTime(r.redeemedAt)}
                  {r.chainError && <span className="block text-caption text-status-danger">{r.chainError}</span>}
                </span>
                {!off && <AdminAction label="Retry redeem" small path={`/v1/admin/blockchain/tickets/${r.ticketId}/retry`} body={{ action: 'redeem' }} />}
              </li>
            ))}
          </ul>
        </section>
      )}

      <FilterTabs base="/admin/blockchain" current={status} options={STATUSES.map((x) => ({ value: x, label: CHAIN_BADGE[x].label }))} />
      <DataTable
        caption="Blockchain transactions"
        head={
          <>
            <Th>Transaction</Th>
            <Th>Ticket</Th>
            <Th>Status</Th>
            <Th>Detail</Th>
            <Th>Action</Th>
          </>
        }
        empty={c.transactions.length === 0 && <p className="p-6 text-body-sm text-ink-secondary">No transactions{status ? ' with this status' : ' yet'}.</p>}
      >
        {c.transactions.map((t) => (
          <tr key={t.id}>
            <Td>
              <span className="font-medium">{t.type.charAt(0) + t.type.slice(1).toLowerCase()}</span>
              {t.txHash && (
                <span className="block font-mono text-caption">
                  {t.txUrl ? (
                    <a href={t.txUrl} target="_blank" rel="noreferrer" className="text-ink-accent">
                      {shortHash(t.txHash)}
                    </a>
                  ) : (
                    shortHash(t.txHash)
                  )}
                </span>
              )}
              <span className="block text-caption text-ink-muted">{formatDateTime(t.createdAt)}</span>
            </Td>
            <Td>
              {t.event ?? '—'}
              {t.tokenId && <span className="block text-caption text-ink-secondary">token #{t.tokenId}</span>}
            </Td>
            <Td>
              <Badge tone={CHAIN_BADGE[t.status]?.tone ?? 'neutral'}>{CHAIN_BADGE[t.status]?.label ?? t.status}</Badge>
              {t.blockNumber && <span className="block text-caption text-ink-muted">block {t.blockNumber.toLocaleString('id-ID')}</span>}
            </Td>
            <Td>{t.errorMessage ? <span className="block max-w-[22rem] text-caption text-ink-secondary">{t.errorMessage}</span> : <span className="text-ink-muted">—</span>}</Td>
            <Td>
              {t.status === 'FAILED' && t.type === 'CANCEL' && t.ticketId && !off ? (
                <AdminAction label="Retry cancel" small path={`/v1/admin/blockchain/tickets/${t.ticketId}/retry`} body={{ action: 'cancel' }} />
              ) : (
                <span className="text-caption text-ink-muted">—</span>
              )}
            </Td>
          </tr>
        ))}
      </DataTable>
      <p className="text-caption text-ink-muted">
        Refund cancels need the backend signer to hold the contract&apos;s admin role. On Sepolia, run <span className="font-mono">pnpm chain:grant-admin:sepolia</span> once with the deployer key. See{' '}
        <Link href="/admin/reconciliation" className="text-ink-accent">
          reconciliation
        </Link>{' '}
        for payments whose tickets are not yet cancelled on-chain.
      </p>
    </>
  );
}
