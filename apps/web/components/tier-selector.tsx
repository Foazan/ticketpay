'use client';

import { formatRupiah, type TicketTierView } from '@ticketpay/shared';
import { Clock } from 'lucide-react';
import { useState } from 'react';
import { formatDateTime } from '@/lib/format';
import { Button } from './ui';

const MAX_PER_ORDER = 6;

export function TierSelector({ tiers }: { tiers: TicketTierView[] }) {
  const [qty, setQty] = useState<Record<string, number>>({});
  const totalQty = Object.values(qty).reduce((a, b) => a + b, 0);
  const subtotal = tiers.reduce((sum, t) => sum + (qty[t.id] ?? 0) * t.price, 0);
  const set = (id: string, n: number) => setQty((q) => ({ ...q, [id]: n }));
  const salesEnd = tiers[0]?.salesEndAt;

  return (
    <aside className="card flex flex-col gap-4 p-6 shadow-card">
      <h2 className="text-h3">Select tickets</h2>
      {tiers.map((t) => {
        const n = qty[t.id] ?? 0;
        const canAdd = t.onSale && n < Math.min(t.available, MAX_PER_ORDER) && totalQty < MAX_PER_ORDER;
        return (
          <div key={t.id} className="flex items-center justify-between rounded-md border border-line p-4">
            <div className="space-y-1">
              <p className="text-title">{t.name}</p>
              <p className="text-label text-ink-accent">{formatRupiah(t.price)}</p>
              <p className="text-caption text-ink-muted">{t.onSale ? `${t.available.toLocaleString('id-ID')} of ${t.quota.toLocaleString('id-ID')} left` : t.available === 0 ? 'Sold out' : 'Not on sale'}</p>
            </div>
            <div className="flex items-center gap-3">
              <button type="button" aria-label={`Remove one ${t.name} ticket`} disabled={n === 0} onClick={() => set(t.id, n - 1)} className="h-8 w-8 rounded-sm border border-line text-title disabled:opacity-40">−</button>
              <span className="w-4 text-center text-title" aria-live="polite">{n}</span>
              <button type="button" aria-label={`Add one ${t.name} ticket`} disabled={!canAdd} onClick={() => set(t.id, n + 1)} className="h-8 w-8 rounded-sm border border-line text-title disabled:opacity-40">+</button>
            </div>
          </div>
        );
      })}
      {salesEnd && (
        <p className="flex items-center gap-2 text-caption text-ink-secondary">
          <Clock size={16} aria-hidden /> Sales open until {formatDateTime(salesEnd)}
        </p>
      )}
      <div className="flex items-center justify-between py-2">
        <span className="text-ink-secondary">Subtotal ({totalQty} {totalQty === 1 ? 'ticket' : 'tickets'})</span>
        <span className="text-title">{formatRupiah(subtotal)}</span>
      </div>
      {/* Checkout is built in the next phase together with the payment backend. */}
      <Button disabled title="Checkout arrives with the payment phase">Buy tickets</Button>
      <p className="text-caption text-ink-muted">Checkout is not available yet in this build. The service fee will be shown separately at checkout.</p>
    </aside>
  );
}
