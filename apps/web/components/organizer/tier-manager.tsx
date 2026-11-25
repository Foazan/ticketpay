'use client';

import { MAX_TIERS_PER_EVENT, formatRupiah, tierSchema, updateTierSchema } from '@ticketpay/shared';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ApiError, apiFetch } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { fromLocalInput, toLocalInput, type OrganizerEvent, type Tier } from '@/lib/organizer';
import { Button } from '../ui';
import { Meter } from './column-chart';

function TierForm({ event, tier, onDone }: { event: OrganizerEvent; tier?: Tier; onDone: () => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const prefix = tier ? `tier-${tier.id}` : 'new-tier';
  // Default sales window: from now until the event starts.
  const defaults = {
    start: tier ? toLocalInput(tier.salesStartAt) : toLocalInput(new Date().toISOString()),
    end: tier ? toLocalInput(tier.salesEndAt) : toLocalInput(event.startAt),
  };

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const body = {
      name: String(f.get('name') ?? ''),
      price: Number(f.get('price')),
      quota: Number(f.get('quota')),
      salesStartAt: fromLocalInput(String(f.get('salesStartAt'))),
      salesEndAt: fromLocalInput(String(f.get('salesEndAt'))),
    };
    const parsed = (tier ? updateTierSchema : tierSchema).safeParse(body);
    const local: Record<string, string> = parsed.success ? {} : Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message]));
    if (new Date(body.salesEndAt) > new Date(event.endAt)) local.salesEndAt = 'Sales must end before the event ends';
    if (Object.keys(local).length) {
      setFieldErrors(local);
      return;
    }
    setBusy(true);
    setError(null);
    setFieldErrors({});
    try {
      await apiFetch(tier ? `/v1/organizer/events/${event.id}/tiers/${tier.id}` : `/v1/organizer/events/${event.id}/tiers`, { method: tier ? 'PATCH' : 'POST', body });
      router.refresh();
      onDone();
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message === 'Validation failed' ? 'Check the highlighted fields.' : err.message);
        setFieldErrors(Object.fromEntries(err.fieldErrors.map((x) => [x.field, x.message])));
      } else setError('Could not reach the server.');
    } finally {
      setBusy(false);
    }
  };

  const field = (name: string, label: string, props: React.InputHTMLAttributes<HTMLInputElement>) => (
    <div>
      <label htmlFor={`${prefix}-${name}`} className="field-label">
        {label}
      </label>
      <input id={`${prefix}-${name}`} name={name} className="field" aria-invalid={!!fieldErrors[name]} {...props} />
      {fieldErrors[name] && <p className="mt-2 text-caption text-status-danger">{fieldErrors[name]}</p>}
    </div>
  );

  return (
    <form method="post" onSubmit={submit} noValidate className="space-y-4 rounded-md border border-line bg-bg-page p-4">
      {error && (
        <p role="alert" className="rounded-md bg-status-danger-soft px-4 py-3 text-body-sm">
          {error}
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-3">
        {field('name', 'Category name', { defaultValue: tier?.name, placeholder: 'Regular', maxLength: 60 })}
        {field('price', 'Price (Rp)', { type: 'number', min: 1000, step: 1000, defaultValue: tier?.price, inputMode: 'numeric' })}
        {field('quota', 'Quota', {
          type: 'number',
          min: tier ? tier.soldCount + tier.heldCount : 1,
          defaultValue: tier?.quota,
          inputMode: 'numeric',
        })}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {field('salesStartAt', 'Sales start (WIB)', { type: 'datetime-local', defaultValue: defaults.start })}
        {field('salesEndAt', 'Sales end (WIB)', { type: 'datetime-local', defaultValue: defaults.end })}
      </div>
      {tier && tier.soldCount + tier.heldCount > 0 && (
        <p className="text-caption text-ink-secondary">
          {tier.soldCount} sold and {tier.heldCount} held in checkout, so the quota cannot go below {tier.soldCount + tier.heldCount}. A new price applies to new orders only.
        </p>
      )}
      <div className="flex gap-3">
        <Button type="submit" disabled={busy}>
          {busy ? 'Saving…' : tier ? 'Save category' : 'Add category'}
        </Button>
        <Button type="button" variant="secondary" onClick={onDone} disabled={busy}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** Ticket categories of one event: list with sell-through, inline edit, add and remove. */
export function TierManager({ event }: { event: OrganizerEvent }) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const locked = event.status === 'ARCHIVED';

  const remove = async (tier: Tier) => {
    if (!window.confirm(`Remove the ticket category "${tier.name}"?`)) return;
    setError(null);
    try {
      await apiFetch(`/v1/organizer/events/${event.id}/tiers/${tier.id}`, { method: 'DELETE' });
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reach the server.');
    }
  };

  return (
    <div className="space-y-4">
      {error && (
        <p role="alert" className="rounded-md bg-status-danger-soft px-4 py-3 text-body-sm">
          {error}
        </p>
      )}
      {event.tiers.length === 0 && editing !== 'new' && <p className="text-body-sm text-ink-secondary">No ticket categories yet. Add at least one before publishing.</p>}
      <ul className="space-y-3">
        {event.tiers.map((t) =>
          editing === t.id ? (
            <li key={t.id}>
              <TierForm event={event} tier={t} onDone={() => setEditing(null)} />
            </li>
          ) : (
            <li key={t.id} className="space-y-2 rounded-md border border-line p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-title">
                    {t.name} <span className="text-body-sm font-normal text-ink-secondary">· {formatRupiah(t.price)}</span>
                  </p>
                  <p className="text-caption text-ink-secondary">
                    On sale {formatDateTime(t.salesStartAt)} to {formatDateTime(t.salesEndAt)}
                  </p>
                </div>
                {!locked && (
                  <div className="flex gap-2">
                    <Button variant="ghost" className="px-3 py-2" onClick={() => setEditing(t.id)} aria-label={`Edit ${t.name}`}>
                      Edit
                    </Button>
                    {t.soldCount + t.heldCount === 0 && (
                      <Button variant="ghost" className="px-3 py-2 text-status-danger" onClick={() => remove(t)} aria-label={`Remove ${t.name}`}>
                        Remove
                      </Button>
                    )}
                  </div>
                )}
              </div>
              <Meter value={t.soldCount} max={t.quota} label={`${t.name}: sold out of quota`} />
              {t.heldCount > 0 && <p className="text-caption text-ink-muted">{t.heldCount} held in checkout right now</p>}
            </li>
          ),
        )}
      </ul>
      {!locked &&
        (editing === 'new' ? (
          <TierForm event={event} onDone={() => setEditing(null)} />
        ) : (
          event.tiers.length < MAX_TIERS_PER_EVENT && (
            <Button variant="secondary" onClick={() => setEditing('new')}>
              Add ticket category
            </Button>
          )
        ))}
    </div>
  );
}
