import type { OrderView } from '@ticketpay/shared';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { OrderStatusView } from '@/components/order-status';
import { ApiError, serverFetch } from '@/lib/api';
import { requireRole } from '@/lib/require-role';
import { cookieHeader } from '@/lib/session';

export const metadata: Metadata = { title: 'Payment status' };
export const dynamic = 'force-dynamic';

/**
 * Where the payment page sends the buyer back. Query parameters added by the provider are ignored:
 * the status shown always comes from the API, which only changes it on a verified notification.
 */
export default async function OrderStatusPage({ params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  await requireRole('BUYER', `/orders/${orderId}/status`);
  let order: OrderView;
  try {
    order = await serverFetch<OrderView>(`/v1/orders/${encodeURIComponent(orderId)}`, await cookieHeader());
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) notFound();
    throw err;
  }
  return (
    <div className="container-page py-16">
      <OrderStatusView initial={order} />
    </div>
  );
}
