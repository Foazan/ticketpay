import type { Metadata } from 'next';
import { PageHeader } from '@/components/organizer/page-header';
import { ReconView } from '@/components/organizer/recon-table';
import { serverFetch } from '@/lib/api';
import type { Reconciliation } from '@/lib/organizer';
import { cookieHeader } from '@/lib/session';

export const metadata: Metadata = { title: 'Reconciliation' };

export default async function AdminReconciliation() {
  const r = await serverFetch<Reconciliation>('/v1/admin/reconciliation', await cookieHeader());
  return (
    <>
      <PageHeader
        title="Reconciliation"
        intro="Every organizer's payments, comparing the provider's status with TicketPay's payment and ledger records and with the tickets on the blockchain. Computed live; problems sort to the top."
      />
      <ReconView report={r} showMerchant paymentHref={(id) => `/admin/payments/${id}`} />
    </>
  );
}
