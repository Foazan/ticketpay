'use client';

import { MAX_FEE_BPS } from '@ticketpay/shared';
import { useRouter } from 'next/navigation';
import { useId, useState, type FormEvent } from 'react';
import { ApiError, apiFetch } from '@/lib/api';
import { useHydrated } from '@/lib/use-hydrated';
import { Button } from '../ui';

type Variant = 'primary' | 'accent' | 'secondary' | 'ghost' | 'danger';

const message = (err: unknown) => (err instanceof ApiError ? err.message : 'Could not reach the server.');

function ErrorText({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p role="alert" className="text-body-sm text-status-danger">
      {error}
    </p>
  );
}

/**
 * One administrator action. With `reason`, the button opens a short form first, because the
 * reason is shown to the organizer or kept in the audit log. The API decides what is allowed.
 */
export function AdminAction({
  label,
  busyLabel,
  path,
  method = 'POST',
  body,
  variant = 'secondary',
  confirm,
  reason,
  small,
}: {
  label: string;
  busyLabel?: string;
  path: string;
  method?: 'POST' | 'DELETE';
  body?: Record<string, unknown>;
  variant?: Variant;
  confirm?: string;
  reason?: { label: string; hint?: string; required?: boolean };
  small?: boolean;
}) {
  const router = useRouter();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hydrated = useHydrated();
  const size = small ? 'px-3 py-2' : undefined;

  const run = async (extra: Record<string, unknown> = {}) => {
    if (confirm && !window.confirm(confirm)) return;
    setBusy(true);
    setError(null);
    try {
      await apiFetch(path, { method, body: { ...body, ...extra } });
      setOpen(false);
      setText('');
      router.refresh();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  };

  if (!reason) {
    return (
      <div className="space-y-2">
        <Button variant={variant} className={size} disabled={busy || !hydrated} onClick={() => run()}>
          {busy ? busyLabel ?? `${label}…` : label}
        </Button>
        <ErrorText error={error} />
      </div>
    );
  }

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (reason.required && text.trim().length < 5) return setError('Give a reason of at least 5 characters.');
    void run({ reason: text.trim() });
  };

  return (
    <div className="space-y-2">
      {!open ? (
        <Button variant={variant} className={size} disabled={!hydrated} onClick={() => setOpen(true)}>
          {label}
        </Button>
      ) : (
        <form method="post" onSubmit={submit} className="card w-full max-w-md space-y-3 p-4">
          <div>
            <label htmlFor={id} className="field-label">
              {reason.label}
            </label>
            <textarea id={id} className="field min-h-20" value={text} onChange={(e) => setText(e.target.value)} maxLength={500} required={reason.required} autoFocus />
            {reason.hint && <p className="mt-1 text-caption text-ink-secondary">{reason.hint}</p>}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant={variant === 'secondary' ? 'primary' : variant} className="px-4 py-2" disabled={busy}>
              {busy ? busyLabel ?? `${label}…` : label}
            </Button>
            <Button type="button" variant="ghost" className="px-4 py-2" onClick={() => (setOpen(false), setError(null))}>
              Cancel
            </Button>
          </div>
          <ErrorText error={error} />
        </form>
      )}
      {!open && <ErrorText error={error} />}
    </div>
  );
}

/** Sets the platform service fee. Entered as a percentage, stored in basis points. */
export function FeeForm({ currentBps }: { currentBps: number }) {
  const router = useRouter();
  const [pct, setPct] = useState(String(currentBps / 100));
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const hydrated = useHydrated();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setDone(null);
    const bps = Math.round(Number(pct.replace(',', '.')) * 100);
    if (!Number.isFinite(bps) || bps < 0 || bps > MAX_FEE_BPS) return setError(`Enter a rate between 0 and ${MAX_FEE_BPS / 100}%.`);
    if (!window.confirm(`Set the service fee to ${bps / 100}% for every new order from now on? Orders already created keep their rate.`)) return;
    setBusy(true);
    try {
      await apiFetch('/v1/admin/fees', { method: 'POST', body: { feeRateBps: bps, note } });
      setNote('');
      setDone(`The service fee is now ${bps / 100}%.`);
      router.refresh();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form method="post" onSubmit={submit} className="card max-w-xl space-y-4 p-6">
      <div className="grid gap-4 sm:grid-cols-[10rem_minmax(0,1fr)]">
        <div>
          <label htmlFor="fee-pct" className="field-label">
            New rate (%)
          </label>
          <input id="fee-pct" className="field" inputMode="decimal" value={pct} onChange={(e) => setPct(e.target.value)} required />
        </div>
        <div>
          <label htmlFor="fee-note" className="field-label">
            Note (optional)
          </label>
          <input id="fee-note" className="field" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder="Why the rate changes" />
        </div>
      </div>
      <p className="text-caption text-ink-secondary">Charged to the buyer on top of the ticket subtotal. At most {MAX_FEE_BPS / 100}%. Applies to new quotes and orders only.</p>
      <Button type="submit" disabled={busy || !hydrated}>
        {busy ? 'Saving…' : 'Save new rate'}
      </Button>
      <ErrorText error={error} />
      {done && (
        <p role="status" className="text-body-sm text-status-success">
          {done}
        </p>
      )}
    </form>
  );
}

/** Creates a gate staff account. The administrator passes the password on to the staff member. */
export function GateStaffForm() {
  const router = useRouter();
  const [form, setForm] = useState({ fullName: '', email: '', password: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const hydrated = useHydrated();
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      await apiFetch('/v1/admin/gate-staff', { method: 'POST', body: form });
      setDone(`Account created for ${form.email}. Assign events below so it can scan tickets.`);
      setForm({ fullName: '', email: '', password: '' });
      router.refresh();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form method="post" onSubmit={submit} className="card space-y-4 p-6">
      <h2 className="text-h3">New gate staff account</h2>
      <div className="grid gap-4 md:grid-cols-3">
        <div>
          <label htmlFor="gs-name" className="field-label">
            Full name
          </label>
          <input id="gs-name" className="field" value={form.fullName} onChange={set('fullName')} required minLength={2} maxLength={120} />
        </div>
        <div>
          <label htmlFor="gs-email" className="field-label">
            Email
          </label>
          <input id="gs-email" type="email" className="field" value={form.email} onChange={set('email')} required autoComplete="off" />
        </div>
        <div>
          <label htmlFor="gs-password" className="field-label">
            Temporary password
          </label>
          <input id="gs-password" type="password" className="field" value={form.password} onChange={set('password')} required minLength={8} autoComplete="new-password" />
        </div>
      </div>
      <Button type="submit" disabled={busy || !hydrated}>
        {busy ? 'Creating…' : 'Create account'}
      </Button>
      <ErrorText error={error} />
      {done && (
        <p role="status" className="text-body-sm text-status-success">
          {done}
        </p>
      )}
    </form>
  );
}

/** Grants one gate staff account access to an event's gate. */
export function AssignEvent({ staffId, events }: { staffId: string; events: { id: string; title: string }[] }) {
  const router = useRouter();
  const id = useId();
  const [eventId, setEventId] = useState('');
  const hydrated = useHydrated();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!eventId) return;
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/v1/admin/gate-staff/${staffId}/events`, { method: 'POST', body: { eventId } });
      setEventId('');
      router.refresh();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  };

  if (events.length === 0) return <p className="text-caption text-ink-muted">Assigned to every event on sale.</p>;
  return (
    <form method="post" onSubmit={submit} className="flex flex-wrap items-end gap-2">
      <div className="min-w-0 flex-1">
        <label htmlFor={id} className="field-label">
          Add an event
        </label>
        <select id={id} className="field" value={eventId} onChange={(e) => setEventId(e.target.value)}>
          <option value="">Choose an event</option>
          {events.map((e) => (
            <option key={e.id} value={e.id}>
              {e.title}
            </option>
          ))}
        </select>
      </div>
      <Button type="submit" variant="secondary" className="px-4 py-3" disabled={busy || !eventId || !hydrated}>
        {busy ? 'Assigning…' : 'Assign'}
      </Button>
      <ErrorText error={error} />
    </form>
  );
}
