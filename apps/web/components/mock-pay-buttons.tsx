'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ApiError, apiFetch } from '@/lib/api';
import { Button } from './ui';

export function MockPayButtons({ paymentId, orderId, disabled }: { paymentId: string; orderId: string; disabled: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = async (outcome: 'paid' | 'failed' | 'expired') => {
    setBusy(outcome);
    setError(null);
    try {
      await apiFetch(`/v1/dev/mock-payments/${paymentId}/simulate`, { method: 'POST', body: { outcome } });
      router.push(`/orders/${orderId}/status`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reach the API.');
      setBusy(null);
    }
  };
  if (disabled) {
    return (
      <Button variant="secondary" onClick={() => router.push(`/orders/${orderId}/status`)} className="w-full">
        This payment is already settled. View order
      </Button>
    );
  }
  return (
    <div className="space-y-3">
      <Button variant="accent" className="w-full" disabled={!!busy} onClick={() => run('paid')}>{busy === 'paid' ? 'Paying…' : 'Simulate successful payment'}</Button>
      <div className="grid grid-cols-2 gap-3">
        <Button variant="secondary" disabled={!!busy} onClick={() => run('failed')}>Simulate failure</Button>
        <Button variant="secondary" disabled={!!busy} onClick={() => run('expired')}>Simulate expiry</Button>
      </div>
      {error && <p role="alert" className="text-body-sm text-status-danger">{error}</p>}
    </div>
  );
}
