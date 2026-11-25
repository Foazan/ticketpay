'use client';

import clsx from 'clsx';
import { Blocks, Building2, CalendarDays, CreditCard, History, LayoutDashboard, ListChecks, Percent, Scale, ScanLine, Webhook } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const ITEMS = [
  { href: '/admin', label: 'Overview', icon: LayoutDashboard, exact: true },
  { href: '/admin/merchants', label: 'Merchants', icon: Building2 },
  { href: '/admin/events', label: 'Events', icon: CalendarDays },
  { href: '/admin/payments', label: 'Payments', icon: CreditCard },
  { href: '/admin/ledger', label: 'Ledger', icon: Scale },
  { href: '/admin/reconciliation', label: 'Reconciliation', icon: ListChecks },
  { href: '/admin/fees', label: 'Service fee', icon: Percent },
  { href: '/admin/webhooks', label: 'Merchant webhooks', icon: Webhook },
  { href: '/admin/blockchain', label: 'Blockchain', icon: Blocks },
  { href: '/admin/gate-staff', label: 'Gate staff', icon: ScanLine },
  { href: '/admin/audit-logs', label: 'Audit log', icon: History },
];

/** Sidebar on wide screens, a scrollable tab row on phones. */
export function AdminNav({ pendingMerchants }: { pendingMerchants: number }) {
  const path = usePathname();
  return (
    <nav aria-label="Administration" className="-mx-4 overflow-x-auto px-4 lg:mx-0 lg:px-0">
      <ul className="flex gap-1 lg:flex-col">
        {ITEMS.map(({ href, label, icon: Icon, exact }) => {
          const active = exact ? path === href : path === href || path.startsWith(`${href}/`);
          const count = href === '/admin/merchants' && pendingMerchants > 0 ? pendingMerchants : null;
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
                {count && (
                  <span className="ml-auto rounded-full bg-status-warning-soft px-2 text-caption text-ink-primary">
                    {count}
                    <span className="sr-only"> awaiting approval</span>
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
