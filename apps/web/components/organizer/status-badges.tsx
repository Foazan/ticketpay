import { Badge } from '../ui';

const ORDER: Record<string, { label: string; tone: 'success' | 'pending' | 'failed' | 'neutral' | 'info' }> = {
  PAID: { label: 'Paid', tone: 'success' },
  PENDING: { label: 'Pending', tone: 'pending' },
  FAILED: { label: 'Failed', tone: 'failed' },
  EXPIRED: { label: 'Expired', tone: 'neutral' },
  REFUNDED: { label: 'Refunded', tone: 'info' },
  REFUND_PENDING: { label: 'Refund pending', tone: 'pending' },
};

/** Order or payment status. Always a word, never color alone. */
export function StatusBadge({ status }: { status: string | null }) {
  if (!status) return <span className="text-ink-muted">—</span>;
  const s = ORDER[status] ?? { label: status, tone: 'neutral' as const };
  return <Badge tone={s.tone}>{s.label}</Badge>;
}
