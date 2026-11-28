'use client';

import type { GateOutcome, GateResult, IdCheckMethod } from '@ticketpay/shared';
import clsx from 'clsx';
import jsQR from 'jsqr';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, apiFetch } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { IdNameScan } from './id-name-scan';
import { Button } from './ui';

type Input = { qr: string } | { code: string };
type Camera = { state: 'starting' } | { state: 'on' } | { state: 'off' } | { state: 'unavailable'; reason: string };

const TITLES: Record<GateOutcome, string> = {
  VALID: 'Valid ticket',
  ADMITTED: 'Admitted',
  ALREADY_REDEEMED: 'Already used',
  INVALID: 'Not valid',
  EXPIRED: 'QR code expired',
  WRONG_EVENT: 'Wrong event',
  NOT_PAID: 'Not paid',
  CANCELLED: 'Cancelled',
  OWNERSHIP_MISMATCH: 'Ownership check failed',
  ID_CHECK_REQUIRED: 'Check ID first',
};

const tone = (r: GateResult) => (r.ok ? 'ok' : r.outcome === 'ALREADY_REDEEMED' || r.outcome === 'EXPIRED' || r.outcome === 'ID_CHECK_REQUIRED' ? 'warn' : 'bad');

/** Outcomes after which staff can still admit this ticket (the ID check is the only thing missing). */
const admissible = (o: GateOutcome) => o === 'VALID' || o === 'ID_CHECK_REQUIRED';

function cameraError(err: unknown): string {
  const name = (err as { name?: string }).name;
  if (name === 'NotAllowedError') return 'Camera permission was denied. Allow it in the browser settings, or use the manual code below.';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No camera was found on this device. Use the manual code below.';
  return 'The camera could not start. Use the manual code below.';
}

/**
 * Gate scanner: camera scanning with jsQR, a manual code fallback, a two-step validate-then-admit
 * flow and the photo ID check. When the organizer turned on "Check ID at the gate" the check is
 * mandatory: this screen cannot switch it off and the API refuses to admit without it.
 * Every decision is made by the API; this screen only shows it.
 */
export function GateScanner({
  eventId,
  initialAdmitted,
  ticketsIssued,
  requiresIdCheck,
}: {
  eventId: string;
  initialAdmitted: number;
  ticketsIssued: number;
  requiresIdCheck: boolean;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const paused = useRef(false);
  const lastText = useRef<{ text: string; at: number } | null>(null);

  const [camera, setCamera] = useState<Camera>({ state: 'starting' });
  const [result, setResult] = useState<GateResult | null>(null);
  const [pending, setPending] = useState<Input | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [idRequired, setIdRequired] = useState(requiresIdCheck);
  const [optionalIdCheck, setOptionalIdCheck] = useState(false);
  const checkId = idRequired || optionalIdCheck;
  const [idConfirmed, setIdConfirmed] = useState(false);
  // How staff checked the ID for the current ticket: by eye, or helped by reading the card.
  const [idCheckMethod, setIdCheckMethod] = useState<IdCheckMethod>('VISUAL');
  const [admitted, setAdmitted] = useState(initialAdmitted);

  const send = useCallback(
    async (action: 'validate' | 'redeem', input: Input, id?: { idChecked: boolean; idCheckMethod: IdCheckMethod }) => {
      setBusy(true);
      setError(null);
      paused.current = true;
      try {
        const res = await apiFetch<GateResult>(`/v1/gate/${action}`, { method: 'POST', body: { eventId, ...input, ...id } });
        // The organizer may have turned the ID check on after this page opened: the API says so.
        if (res.requiresIdCheck) setIdRequired(true);
        setResult(res);
        setPending(admissible(res.outcome) ? input : null);
        setIdConfirmed(false);
        setIdCheckMethod('VISUAL');
        if (res.outcome === 'ADMITTED') setAdmitted((n) => n + 1);
        navigator.vibrate?.(res.ok ? 80 : [60, 60, 60]);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Could not reach the server. Check the connection and try again.');
        paused.current = false;
      } finally {
        setBusy(false);
      }
    },
    [eventId],
  );

  const reset = () => {
    setResult(null);
    setPending(null);
    setError(null);
    setIdConfirmed(false);
    setIdCheckMethod('VISUAL');
    lastText.current = null;
    paused.current = false;
  };

  // Camera and decode loop.
  useEffect(() => {
    let raf = 0;
    let lastDecode = 0;
    let cancelled = false;

    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const v = video.current;
      const c = canvas.current;
      if (paused.current || !v || !c || v.readyState < 2 || now - lastDecode < 150) return;
      lastDecode = now;
      const scale = Math.min(1, 640 / v.videoWidth);
      c.width = Math.round(v.videoWidth * scale);
      c.height = Math.round(v.videoHeight * scale);
      const g = c.getContext('2d', { willReadFrequently: true });
      if (!g) return;
      g.drawImage(v, 0, 0, c.width, c.height);
      const found = jsQR(g.getImageData(0, 0, c.width, c.height).data, c.width, c.height, { inversionAttempts: 'dontInvert' });
      if (!found?.data) return;
      // The same code stays in view for a while; act on it once.
      if (lastText.current && lastText.current.text === found.data && now - lastText.current.at < 4000) return;
      lastText.current = { text: found.data, at: now };
      void send('validate', { qr: found.data.trim() });
    };

    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setCamera({ state: 'unavailable', reason: 'This browser cannot use the camera here (it needs HTTPS or localhost). Use the manual code below.' });
        return;
      }
      try {
        const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        stream.current = s;
        if (video.current) {
          video.current.srcObject = s;
          await video.current.play().catch(() => undefined);
        }
        setCamera({ state: 'on' });
        raf = requestAnimationFrame(loop);
      } catch (err) {
        setCamera({ state: 'unavailable', reason: cameraError(err) });
      }
    })();

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      stream.current?.getTracks().forEach((t) => t.stop());
    };
  }, [send]);

  const submitCode = (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim()) return;
    void send('validate', { code: code.trim() });
  };

  const t = result ? tone(result) : null;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="space-y-4">
        <div className="relative aspect-[4/3] overflow-hidden rounded-lg bg-brand-navy">
          <video ref={video} muted playsInline className={clsx('h-full w-full object-cover', camera.state !== 'on' && 'hidden')} aria-label="Camera preview" />
          <canvas ref={canvas} className="hidden" />
          {camera.state === 'on' && (
            <div aria-hidden className="pointer-events-none absolute inset-[18%] rounded-lg border-4 border-white/80 shadow-[0_0_0_999px_rgba(11,31,58,0.35)]" />
          )}
          {camera.state !== 'on' && (
            <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-body-sm text-ink-inverse">
              {camera.state === 'starting' ? 'Starting camera…' : camera.state === 'unavailable' ? camera.reason : 'Camera off'}
            </div>
          )}
        </div>
        <p className="text-body-sm text-ink-secondary">
          {camera.state === 'on' ? 'Hold the ticket QR inside the frame. It is checked automatically.' : 'Ask the holder to read out the code under their QR.'}
        </p>

        <form method="post" onSubmit={submitCode} className="card space-y-3 p-4">
          <label htmlFor="manual-code" className="text-label">
            Manual code
          </label>
          <div className="flex gap-2">
            <input
              id="manual-code"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="TP-XXXX-XXXX"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              className="min-w-0 flex-1 rounded-md border border-line px-4 py-3 font-mono tracking-wider focus:outline focus:outline-2 focus:outline-accent-teal"
            />
            <Button type="submit" variant="primary" disabled={busy || !code.trim()}>
              Check
            </Button>
          </div>
        </form>

        {idRequired ? (
          <div className="rounded-md border-2 border-status-warning bg-status-warning-soft p-4 text-body-sm">
            <p className="text-label">Photo ID check required</p>
            <p className="text-ink-secondary">
              The organizer requires an ID check for this event. Before admitting, compare the holder name with a photo ID (KTP, SIM or passport). Do not photograph or keep the ID.
            </p>
          </div>
        ) : (
          <label className="flex items-start gap-3 text-body-sm">
            <input type="checkbox" className="mt-1 h-4 w-4" checked={optionalIdCheck} onChange={(e) => setOptionalIdCheck(e.target.checked)} />
            <span>
              <span className="text-label">Also check a photo ID (optional)</span>
              <span className="block text-ink-secondary">Not required for this event. Compare the holder name with a photo ID before admitting. Do not photograph or keep the ID.</span>
            </span>
          </label>
        )}
      </div>

      {/* On a phone the result comes first, so staff never scroll to see it. */}
      <div className="order-first space-y-4 lg:order-none">
        <div className="card flex items-baseline justify-between p-4">
          <span className="text-body-sm text-ink-secondary">Admitted</span>
          <span>
            <span className="text-h2">{admitted}</span> <span className="text-body-sm text-ink-secondary">of {ticketsIssued}</span>
          </span>
        </div>

        <div aria-live="assertive" aria-atomic="true">
          {error && (
            <div role="alert" className="card space-y-3 border-status-danger p-6">
              <p className="text-title">Could not check this ticket</p>
              <p className="text-body-sm">{error}</p>
              <Button variant="secondary" onClick={reset}>
                Try again
              </Button>
            </div>
          )}

          {!error && !result && (
            <div className={clsx('card min-h-[16rem] items-center justify-center p-6 text-center text-ink-secondary lg:flex', busy ? 'flex' : 'hidden')}>
              {busy ? 'Checking…' : 'Waiting for a ticket'}
            </div>
          )}

          {!error && result && (
            <div
              data-outcome={result.outcome}
              className={clsx(
                'card space-y-4 border-2 p-6 lg:min-h-[16rem]',
                t === 'ok' && 'border-status-success bg-status-success-soft',
                t === 'warn' && 'border-status-warning bg-status-warning-soft',
                t === 'bad' && 'border-status-danger bg-status-danger-soft',
              )}
            >
              <div>
                <p className="text-h2">{TITLES[result.outcome]}</p>
                <p className="text-body">{result.message}</p>
              </div>

              {result.ticket && (
                <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1 text-body-sm">
                  <dt className="text-ink-secondary">Holder</dt>
                  <dd className="text-title">{result.ticket.holderName}</dd>
                  <dt className="text-ink-secondary">Ticket</dt>
                  <dd>
                    {result.ticket.tierName} · #{result.ticket.seq}
                  </dd>
                  {result.ticket.tokenId && (
                    <>
                      <dt className="text-ink-secondary">NFT</dt>
                      <dd>
                        #{result.ticket.tokenId}
                        {result.chainOwner === 'MATCH' && ' · owner verified on-chain'}
                      </dd>
                    </>
                  )}
                  {result.redeemedAt && (
                    <>
                      <dt className="text-ink-secondary">Used</dt>
                      <dd>
                        {formatDateTime(result.redeemedAt)}
                        {result.redeemedBy ? ` by ${result.redeemedBy}` : ''}
                      </dd>
                    </>
                  )}
                </dl>
              )}

              {result.holderNameChangedAt && (
                <p role="note" className="rounded-md border border-status-warning bg-bg-surface px-3 py-2 text-body-sm">
                  The holder changed their account name on {formatDateTime(result.holderNameChangedAt)}, after this ticket was bought. Check the photo ID carefully.
                </p>
              )}

              {admissible(result.outcome) && pending && (
                <div className="space-y-3">
                  {checkId && result.ticket && <IdNameScan key={result.ticket.id} holderName={result.ticket.holderName} onResult={setIdCheckMethod} />}
                  {checkId && result.ticket && (
                    <label className="flex items-start gap-3 text-body-sm">
                      <input type="checkbox" className="mt-1 h-4 w-4" checked={idConfirmed} onChange={(e) => setIdConfirmed(e.target.checked)} />
                      <span>I checked a photo ID and the name matches {result.ticket.holderName}.</span>
                    </label>
                  )}
                  <div className="grid grid-cols-2 gap-3">
                    <Button variant="accent" disabled={busy || (checkId && !idConfirmed)} onClick={() => void send('redeem', pending, checkId ? { idChecked: idConfirmed, idCheckMethod } : undefined)}>
                      {busy ? 'Admitting…' : 'Admit'}
                    </Button>
                    <Button variant="secondary" disabled={busy} onClick={reset}>
                      Don’t admit
                    </Button>
                  </div>
                </div>
              )}

              {result.outcome !== 'VALID' && (
                <Button variant={result.ok ? 'primary' : 'secondary'} className="w-full" onClick={() => {
                  reset();
                  setCode('');
                }}>
                  Scan next ticket
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
