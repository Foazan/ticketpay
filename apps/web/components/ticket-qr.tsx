'use client';

import type { TicketQr as TicketQrPayload } from '@ticketpay/shared';
import QRCode from 'qrcode';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, apiFetch } from '@/lib/api';

/**
 * The entry QR. Each code is single-use and expires within about a minute and a half; a new one is
 * fetched every refreshInSeconds and whenever the page becomes visible again, so a screenshot or a
 * forwarded photo stops working almost immediately.
 */
export function TicketQr({ ticketId, validationCode }: { ticketId: string; validationCode: string | null }) {
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const nextAt = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    try {
      const payload = await apiFetch<TicketQrPayload>(`/v1/tickets/${ticketId}/qr`);
      setSvg(await QRCode.toString(payload.qr, { type: 'svg', errorCorrectionLevel: 'M', margin: 1, color: { dark: '#0F172A', light: '#FFFFFF' } }));
      setError(null);
      nextAt.current = Date.now() + payload.refreshInSeconds * 1000;
      setSecondsLeft(payload.refreshInSeconds);
      timer.current = setTimeout(load, payload.refreshInSeconds * 1000);
    } catch (err) {
      setSvg(null);
      setError(err instanceof ApiError ? err.message : 'Could not load your entry code. Check your connection.');
      // Try again shortly; the ticket page may simply have lost its connection.
      nextAt.current = Date.now() + 10_000;
      timer.current = setTimeout(load, 10_000);
    }
  }, [ticketId]);

  useEffect(() => {
    void load();
    const tick = setInterval(() => setSecondsLeft(Math.max(0, Math.ceil((nextAt.current - Date.now()) / 1000))), 500);
    const onVisible = () => document.visibilityState === 'visible' && void load();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(tick);
      if (timer.current) clearTimeout(timer.current);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [load]);

  return (
    <div className="flex flex-col items-center gap-3 rounded-md border border-line bg-bg-surface p-4">
      <div className="flex aspect-square w-full max-w-[15rem] items-center justify-center" aria-live="polite">
        {svg ? (
          // The SVG comes from the qrcode library for our own payload, not from user input.
          <div role="img" aria-label="Entry QR code. Show this at the gate." className="w-full [&>svg]:h-auto [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: svg }} />
        ) : error ? (
          <p role="alert" className="text-center text-body-sm text-status-danger">{error}</p>
        ) : (
          <div className="h-full w-full animate-pulse rounded-md bg-bg-muted" aria-label="Loading entry code" />
        )}
      </div>
      {svg && <p className="text-caption text-ink-secondary">New code in {secondsLeft}s · each code works once</p>}
      {validationCode && (
        <p className="text-center text-body-sm text-ink-secondary">
          Camera not working at the gate? Read out this code:
          <span className="mt-1 block font-mono text-title tracking-wider text-ink-primary">{validationCode}</span>
        </p>
      )}
    </div>
  );
}
