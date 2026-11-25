import type { Metadata } from 'next';
import { PageHeader } from '@/components/organizer/page-header';
import { ReconView } from '@/components/organizer/recon-table';
import { serverFetch } from '@/lib/api';
import type { Reconciliation } from '@/lib/organizer';
import { cookieHeader } from '@/lib/session';

export const metadata: Metadata = { title: 'Reconciliation' };

export default async function ReconciliationPage() {
  const r = await serverFetch<Reconciliation>('/v1/organizer/reconciliation', await cookieHeader());
  return (
    <>
      <PageHeader
        title="Reconciliation"
        intro="For each payment, the provider's status is compared with TicketPay's payment and ledger records and with ticket issuance on the blockchain. Computed live from the records; no settlement data is invented."
      />
      <ReconView report={r} />
    </>
  );
}
