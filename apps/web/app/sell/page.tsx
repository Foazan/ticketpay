import type { Metadata } from 'next';
import { ButtonLink } from '@/components/ui';

export const metadata: Metadata = { title: 'Sell tickets' };

export default function SellPage() {
  return (
    <div className="container-page py-16">
      <div className="card mx-auto max-w-2xl space-y-4 p-8">
        <h1 className="text-h2">Sell tickets on TicketPay</h1>
        <p className="text-ink-secondary">
          Organizers publish events, set ticket categories and quotas, and follow every transaction, ledger entry and reconciliation result from one
          dashboard. New organizer accounts are reviewed by a TicketPay administrator before they can publish.
        </p>
        <div className="flex flex-wrap gap-3">
          <ButtonLink href="/register/organizer">Register as an organizer</ButtonLink>
          <ButtonLink href="/login?next=/organizer" variant="secondary">
            Organizer login
          </ButtonLink>
        </div>
      </div>
    </div>
  );
}
