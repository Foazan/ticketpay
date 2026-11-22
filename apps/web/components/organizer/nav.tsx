'use client';

import clsx from 'clsx';
import { BarChart3, CalendarDays, LayoutDashboard, ListChecks, ReceiptText, Scale, Settings } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const ITEMS = [
  { href: '/organizer', label: 'Overview', icon: LayoutDashboard, exact: true },
  { href: '/organizer/events', label: 'Events', icon: CalendarDays },
  { href: '/organizer/transactions', label: 'Transactions', icon: ReceiptText },
  { href: '/organizer/analytics', label: 'Sales analytics', icon: BarChart3 },
  { href: '/organizer/ledger', label: 'Ledger', icon: Scale },
  { href: '/organizer/reconciliation', label: 'Reconciliation', icon: ListChecks },
  { href: '/organizer/settings', label: 'Merchant settings', icon: Settings },
];

/** Sidebar on wide screens, a scrollable tab row on phones. */
export function OrganizerNav() {
  const path = usePathname();
  return (
    <nav aria-label="Organizer" className="-mx-4 overflow-x-auto px-4 lg:mx-0 lg:px-0">
      <ul className="flex gap-1 lg:flex-col">
        {ITEMS.map(({ href, label, icon: Icon, exact }) => {
          const active = exact ? path === href : path === href || path.startsWith(`${href}/`);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? 'page' : undefined}
                className={clsx(
                  'flex items-center gap-3 whitespace-nowrap rounded-md px-3 py-2 text-label transition-colors',
                  active ? 'bg-accent-teal-soft text-ink-primary' : 'text-ink-secondary hover:bg-bg-muted hover:text-ink-primary',
                )}
              >
                <Icon size={18} aria-hidden className={active ? 'text-ink-accent' : undefined} />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
