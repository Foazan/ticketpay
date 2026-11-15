import { formatRupiah } from '@ticketpay/shared';
import { RoleHome } from '@/components/role-home';
import { Badge } from '@/components/ui';
import { serverFetch } from '@/lib/api';
import { requireRole } from '@/lib/require-role';
import { cookieHeader } from '@/lib/session';

export const dynamic = 'force-dynamic';

type Overview = { totalEvents: number; publishedEvents: number; ticketsSold: number; totalRevenue: number; pendingPayments: number; estimatedBalance: number };

export default async function OrganizerHome() {
  const user = await requireRole('ORGANIZER', '/organizer');
  const o = await serverFetch<Overview>('/v1/organizer/overview', await cookieHeader());
  const status = user.merchant?.status ?? 'PENDING';
  return (
    <RoleHome
      title={user.merchant?.businessName ?? 'Organizer'}
      intro="Organizer overview."
      stats={[
        ['Published events', `${o.publishedEvents} of ${o.totalEvents}`],
        ['Tickets sold', o.ticketsSold.toLocaleString('id-ID')],
        ['Ticket sales', formatRupiah(o.totalRevenue)],
        ['Estimated balance', formatRupiah(o.estimatedBalance)],
      ]}
    >
      <p className="flex items-center gap-3 text-body-sm text-ink-secondary">
        Merchant status <Badge tone={status === 'APPROVED' ? 'success' : status === 'PENDING' ? 'pending' : 'failed'}>{status}</Badge>
        {status !== 'APPROVED' && 'You can publish events once an administrator approves your account.'}
      </p>
    </RoleHome>
  );
}
