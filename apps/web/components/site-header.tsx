import { ROLE_HOME } from '@ticketpay/shared';
import { Ticket } from 'lucide-react';
import Link from 'next/link';
import { getSession } from '@/lib/session';
import { LogoutButton } from './logout-button';
import { ButtonLink } from './ui';

export async function SiteHeader() {
  const user = await getSession();
  return (
    <header className="border-b border-line bg-bg-surface">
      <div className="container-page flex flex-wrap items-center justify-between gap-4 py-4">
        <Link href="/" className="flex items-center gap-2 text-h3">
          <Ticket className="text-accent-teal" size={28} aria-hidden /> TicketPay
        </Link>
        <nav className="order-3 flex w-full items-center justify-center gap-8 text-label sm:order-none sm:w-auto" aria-label="Main">
          <Link href="/">Home</Link>
          <Link href="/events" className="text-ink-secondary hover:text-ink-primary">Explore Events</Link>
          {user?.role === 'GATE_STAFF' ? (
            <Link href="/gate" className="text-ink-secondary hover:text-ink-primary">Gate</Link>
          ) : (
            <Link href="/buyer/tickets" className="text-ink-secondary hover:text-ink-primary">My Tickets</Link>
          )}
        </nav>
        <div className="flex items-center gap-3">
          {user ? (
            <>
              <Link href={ROLE_HOME[user.role]} className="text-label text-ink-secondary hover:text-ink-primary">
                {user.fullName}
              </Link>
              <LogoutButton />
            </>
          ) : (
            <>
              <ButtonLink href="/sell" variant="ghost" className="hidden md:inline-flex">Sell Tickets</ButtonLink>
              <ButtonLink href="/login" variant="secondary">Login</ButtonLink>
              <ButtonLink href="/register" variant="primary">Sign Up</ButtonLink>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="mt-16 bg-brand-navy text-ink-inverse">
      <div className="container-page flex flex-col justify-between gap-10 py-12 md:flex-row">
        <div className="max-w-md space-y-3">
          <p className="text-h3">TicketPay</p>
          <p className="text-body-sm opacity-90">
            Academic prototype. Payments run in Midtrans Sandbox and tickets are recorded on the Ethereum Sepolia testnet. No real funds are
            processed, and all events shown are fictional.
          </p>
        </div>
        <div className="flex gap-16 text-body-sm">
          <div className="flex flex-col gap-3">
            <p className="text-label">Discover</p>
            <Link href="/events">Explore Events</Link>
            <Link href="/buyer/tickets">My Tickets</Link>
          </div>
          <div className="flex flex-col gap-3">
            <p className="text-label">Organizers</p>
            <Link href="/sell">Sell Tickets</Link>
            <Link href="/login">Organizer login</Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
