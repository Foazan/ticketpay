import { RoleHome } from '@/components/role-home';
import { serverFetch } from '@/lib/api';
import { requireRole } from '@/lib/require-role';
import { cookieHeader } from '@/lib/session';

export const dynamic = 'force-dynamic';

type Overview = { merchants: Record<string, number>; events: Record<string, number>; payments: Record<string, number> };

export default async function AdminHome() {
  await requireRole('ADMIN', '/admin');
  const o = await serverFetch<Overview>('/v1/admin/overview', await cookieHeader());
  return (
    <RoleHome
      title="Platform administration"
      intro="Platform overview."
      stats={[
        ['Approved merchants', o.merchants.APPROVED ?? 0],
        ['Merchants awaiting approval', o.merchants.PENDING ?? 0],
        ['Published events', o.events.PUBLISHED ?? 0],
        ['Paid payments', o.payments.PAID ?? 0],
      ]}
    />
  );
}
