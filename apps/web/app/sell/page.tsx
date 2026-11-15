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
        <p className="text-body-sm text-ink-muted">The organizer registration form is part of the next build. Existing organizers can log in now.</p>
        <ButtonLink href="/login">Organizer login</ButtonLink>
      </div>
    </div>
  );
}
