import type { ReactNode } from 'react';
import { AdminNav } from '@/components/admin/nav';
import { Badge } from '@/components/ui';
import { serverFetch } from '@/lib/api';
import type { AdminMerchantRow } from '@/lib/admin';
import { requireRole } from '@/lib/require-role';
import { cookieHeader } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const user = await requireRole('ADMIN', '/admin');
  const pending = await serverFetch<AdminMerchantRow[]>('/v1/admin/merchants?status=PENDING', await cookieHeader());
  return (
    <div className="container-page grid grid-cols-[minmax(0,1fr)] gap-8 py-8 lg:grid-cols-[14rem_minmax(0,1fr)]">
      <aside className="min-w-0 space-y-4 lg:sticky lg:top-6 lg:self-start">
        <div className="space-y-1 px-3">
          <p className="text-title">{user.fullName}</p>
          <Badge tone="info">Platform administrator</Badge>
        </div>
        <AdminNav pendingMerchants={pending.length} />
      </aside>
      <div className="min-w-0 space-y-6">
        <p className="rounded-md bg-bg-muted px-4 py-3 text-caption text-ink-secondary">
          Academic prototype. Payments run in the Midtrans sandbox and NFTs on the Sepolia testnet. TicketPay is not a licensed payment service provider (PJP); refunds here are simulated and move no money.
        </p>
        {children}
      </div>
    </div>
  );
}
