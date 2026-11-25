import { formatRupiah } from '@ticketpay/shared';
import type { Metadata } from 'next';
import Link from 'next/link';
import { AdminAction } from '@/components/admin/actions';
import { FilterTabs } from '@/components/admin/filter-tabs';
import { PageHeader } from '@/components/organizer/page-header';
import { DataTable, Td, Th } from '@/components/organizer/table';
import { Badge } from '@/components/ui';
import { serverFetch } from '@/lib/api';
import { MERCHANT_BADGE, query, type AdminMerchantRow } from '@/lib/admin';
import { formatDate } from '@/lib/format';
import { cookieHeader } from '@/lib/session';

export const metadata: Metadata = { title: 'Merchants' };

const STATUSES = ['PENDING', 'APPROVED', 'SUSPENDED', 'REJECTED'] as const;

export default async function MerchantsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status = '' } = await searchParams;
  const rows = await serverFetch<AdminMerchantRow[]>(`/v1/admin/merchants${query({ status })}`, await cookieHeader());
  return (
    <>
      <PageHeader
        title="Merchants"
        intro="Organizers registered as TicketPay merchants. Only approved merchants can publish events and take payments. Applications awaiting approval are listed first."
      />
      <FilterTabs base="/admin/merchants" current={status} options={STATUSES.map((s) => ({ value: s, label: MERCHANT_BADGE[s].label }))} />
      <DataTable
        caption="Merchants"
        head={
          <>
            <Th>Organizer</Th>
            <Th>Contact</Th>
            <Th>Status</Th>
            <Th right>Events</Th>
            <Th right>Paid volume</Th>
            <Th>Registered</Th>
            <Th>Action</Th>
          </>
        }
        empty={rows.length === 0 && <p className="p-6 text-body-sm text-ink-secondary">No merchants with this status.</p>}
      >
        {rows.map((m) => (
          <tr key={m.id}>
            <Td>
              <Link href={`/admin/merchants/${m.id}`} className="font-medium text-ink-accent underline-offset-2 hover:underline">
                {m.businessName}
              </Link>
              <span className="block text-caption text-ink-secondary">{m.organizerType}</span>
            </Td>
            <Td>
              {m.contactPerson}
              <span className="block text-caption text-ink-secondary">{m.email}</span>
            </Td>
            <Td>
              <Badge tone={MERCHANT_BADGE[m.status].tone}>{MERCHANT_BADGE[m.status].label}</Badge>
              {m.statusReason && <span className="mt-1 block max-w-[16rem] text-caption text-ink-secondary">{m.statusReason}</span>}
            </Td>
            <Td right>{m.eventCount}</Td>
            <Td right>{formatRupiah(m.grossVolume)}</Td>
            <Td>{formatDate(m.createdAt)}</Td>
            <Td>
              {m.status === 'PENDING' ? (
                <AdminAction label="Approve" variant="accent" small path={`/v1/admin/merchants/${m.id}/approve`} confirm={`Approve ${m.businessName}? They can then publish events and take payments.`} />
              ) : (
                <Link href={`/admin/merchants/${m.id}`} className="text-label text-ink-accent">
                  Review
                </Link>
              )}
            </Td>
          </tr>
        ))}
      </DataTable>
    </>
  );
}
