import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader } from '@/components/organizer/page-header';
import { DataTable, Td, Th } from '@/components/organizer/table';
import { Button } from '@/components/ui';
import { serverFetch } from '@/lib/api';
import { query, type AuditPage } from '@/lib/admin';
import { formatDateTime } from '@/lib/format';
import { cookieHeader } from '@/lib/session';

export const metadata: Metadata = { title: 'Audit log' };

const ROLES = ['ADMIN', 'ORGANIZER', 'BUYER', 'GATE_STAFF', 'SYSTEM'];

function MetaList({ value }: { value: Record<string, unknown> | null }) {
  if (!value || Object.keys(value).length === 0) return <span className="text-ink-muted">—</span>;
  return (
    <dl className="space-y-0.5 text-caption">
      {Object.entries(value).map(([k, v]) => (
        <div key={k} className="flex gap-1">
          <dt className="text-ink-secondary">{k}:</dt>
          <dd className="min-w-0 break-all">{typeof v === 'object' ? JSON.stringify(v) : String(v)}</dd>
        </div>
      ))}
    </dl>
  );
}

export default async function AuditLogPage({ searchParams }: { searchParams: Promise<{ action?: string; entityType?: string; actorRole?: string; page?: string }> }) {
  const { action = '', entityType = '', actorRole = '', page = '1' } = await searchParams;
  const p = Math.max(1, Number.parseInt(page, 10) || 1);
  const a = await serverFetch<AuditPage>(`/v1/admin/audit-logs${query({ action, entityType, actorRole, page: p })}`, await cookieHeader());
  const pages = Math.max(1, Math.ceil(a.total / a.pageSize));
  const link = (n: number) => `/admin/audit-logs${query({ action, entityType, actorRole, page: n })}`;
  return (
    <>
      <PageHeader title="Audit log" intro="Security-relevant actions: sign-ins, merchant decisions, fee changes, refunds, API keys, gate admissions and retries. Each entry records who acted, from which address and when." />
      <form className="flex flex-wrap items-end gap-3" method="get">
        <div>
          <label htmlFor="action" className="field-label">
            Action starts with
          </label>
          <input id="action" name="action" defaultValue={action} className="field" placeholder="merchant." />
        </div>
        <div>
          <label htmlFor="entityType" className="field-label">
            Record type
          </label>
          <select id="entityType" name="entityType" defaultValue={entityType} className="field">
            <option value="">All</option>
            {a.entityTypes.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="actorRole" className="field-label">
            Actor role
          </label>
          <select id="actorRole" name="actorRole" defaultValue={actorRole} className="field">
            <option value="">All</option>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r.replace('_', ' ').toLowerCase()}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" variant="secondary">
          Apply
        </Button>
      </form>
      <DataTable
        caption="Audit log"
        head={
          <>
            <Th>When</Th>
            <Th>Action</Th>
            <Th>Actor</Th>
            <Th>Record</Th>
            <Th>Details</Th>
            <Th>Address</Th>
          </>
        }
        empty={a.rows.length === 0 && <p className="p-6 text-body-sm text-ink-secondary">No entries match.</p>}
      >
        {a.rows.map((r) => (
          <tr key={r.id}>
            <Td>{formatDateTime(r.createdAt)}</Td>
            <Td mono>{r.action}</Td>
            <Td>
              {r.actor ?? <span className="text-ink-muted">System</span>}
              {r.actorRole && <span className="block text-caption text-ink-secondary">{r.actorRole.replace('_', ' ').toLowerCase()}</span>}
            </Td>
            <Td>
              {r.entityType}
              {r.entityId && <span className="block font-mono text-caption text-ink-muted">{r.entityId}</span>}
            </Td>
            <Td>
              <MetaList value={r.metadata} />
            </Td>
            <Td mono>{r.ipAddress ?? '—'}</Td>
          </tr>
        ))}
      </DataTable>
      <nav aria-label="Pages" className="flex flex-wrap items-center justify-between gap-3 text-body-sm">
        <span className="text-ink-secondary">
          {a.total.toLocaleString('id-ID')} entries · page {a.page} of {pages}
        </span>
        <span className="flex gap-3">
          {a.page > 1 && (
            <Link href={link(a.page - 1)} className="text-label text-ink-accent">
              Newer
            </Link>
          )}
          {a.page < pages && (
            <Link href={link(a.page + 1)} className="text-label text-ink-accent">
              Older
            </Link>
          )}
        </span>
      </nav>
    </>
  );
}
