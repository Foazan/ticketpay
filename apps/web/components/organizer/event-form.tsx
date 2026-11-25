'use client';

import { createEventSchema, updateEventSchema } from '@ticketpay/shared';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ApiError, apiFetch } from '@/lib/api';
import { fromLocalInput, toLocalInput, type OrganizerEvent } from '@/lib/organizer';
import { Button } from '../ui';

type Category = { id: string; name: string };

/**
 * Create or edit an event's details. Validated in the browser with the same schema the API uses,
 * so the organizer sees the same messages either way. Times are entered in WIB.
 */
export function EventForm({ categories, event }: { categories: Category[]; event?: OrganizerEvent }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const locked = event?.status === 'ARCHIVED';

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const raw = {
      title: String(f.get('title') ?? ''),
      categoryId: String(f.get('categoryId') ?? ''),
      description: String(f.get('description') ?? ''),
      city: String(f.get('city') ?? ''),
      venue: String(f.get('venue') ?? ''),
      startAt: f.get('startAt') ? fromLocalInput(String(f.get('startAt'))) : '',
      endAt: f.get('endAt') ? fromLocalInput(String(f.get('endAt'))) : '',
      requiresIdCheck: f.get('requiresIdCheck') === 'on',
    };
    // When editing, dates that did not change are not re-validated as "must be in the future".
    const body: Record<string, unknown> = { ...raw };
    if (event) {
      if (raw.startAt === new Date(event.startAt).toISOString()) delete body.startAt;
      if (raw.endAt === new Date(event.endAt).toISOString()) delete body.endAt;
    }
    const parsed = (event ? updateEventSchema : createEventSchema).safeParse(body);
    if (!parsed.success) {
      setFieldErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
      setError('Check the highlighted fields.');
      return;
    }
    setBusy(true);
    setError(null);
    setFieldErrors({});
    setSaved(false);
    try {
      const res = await apiFetch<OrganizerEvent>(event ? `/v1/organizer/events/${event.id}` : '/v1/organizer/events', { method: event ? 'PATCH' : 'POST', body });
      if (event) {
        setSaved(true);
        router.refresh();
      } else {
        router.push(`/organizer/events/${res.id}?created=1`);
      }
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message === 'Validation failed' ? 'Check the highlighted fields.' : err.message);
        setFieldErrors(Object.fromEntries(err.fieldErrors.map((x) => [x.field, x.message])));
      } else setError('Could not reach the server.');
    } finally {
      setBusy(false);
    }
  };

  const err = (name: string) =>
    fieldErrors[name] ? (
      <p id={`${name}-error`} className="mt-2 text-caption text-status-danger">
        {fieldErrors[name]}
      </p>
    ) : null;
  const aria = (name: string) => ({ 'aria-invalid': !!fieldErrors[name], 'aria-describedby': fieldErrors[name] ? `${name}-error` : undefined });

  return (
    <form method="post" onSubmit={submit} noValidate className="space-y-5">
      {error && (
        <p role="alert" className="rounded-md bg-status-danger-soft px-4 py-3 text-body-sm">
          {error}
        </p>
      )}
      {saved && (
        <p role="status" className="rounded-md bg-status-success-soft px-4 py-3 text-body-sm">
          Changes saved.
        </p>
      )}
      <fieldset disabled={locked || busy} className="space-y-5">
        <div>
          <label htmlFor="title" className="field-label">
            Event name
          </label>
          <input id="title" name="title" className="field" defaultValue={event?.title} maxLength={120} {...aria('title')} />
          {err('title')}
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <label htmlFor="categoryId" className="field-label">
              Category
            </label>
            <select id="categoryId" name="categoryId" className="field" defaultValue={event?.categoryId ?? ''} {...aria('categoryId')}>
              <option value="" disabled>
                Choose a category
              </option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            {err('categoryId')}
          </div>
          <div>
            <label htmlFor="city" className="field-label">
              City
            </label>
            <input id="city" name="city" className="field" defaultValue={event?.city} maxLength={60} {...aria('city')} />
            {err('city')}
          </div>
        </div>
        <div>
          <label htmlFor="venue" className="field-label">
            Venue
          </label>
          <input id="venue" name="venue" className="field" defaultValue={event?.venue} maxLength={160} {...aria('venue')} />
          {err('venue')}
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <label htmlFor="startAt" className="field-label">
              Starts (WIB)
            </label>
            <input id="startAt" name="startAt" type="datetime-local" className="field" defaultValue={event ? toLocalInput(event.startAt) : ''} {...aria('startAt')} />
            {err('startAt')}
          </div>
          <div>
            <label htmlFor="endAt" className="field-label">
              Ends (WIB)
            </label>
            <input id="endAt" name="endAt" type="datetime-local" className="field" defaultValue={event ? toLocalInput(event.endAt) : ''} {...aria('endAt')} />
            {err('endAt')}
          </div>
        </div>
        <div>
          <label htmlFor="description" className="field-label">
            Description
          </label>
          <textarea id="description" name="description" rows={5} className="field" defaultValue={event?.description} maxLength={4000} {...aria('description')} />
          {err('description')}
        </div>
        <label className="flex items-start gap-3 text-body-sm">
          <input type="checkbox" name="requiresIdCheck" defaultChecked={event?.requiresIdCheck} className="mt-1 h-4 w-4 accent-[#0E9AA0]" />
          <span>
            <span className="text-label">Check ID at the gate</span>
            <span className="block text-ink-secondary">Gate staff compare the ticket holder name with a photo ID. Nothing is photographed or stored.</span>
          </span>
        </label>
        <Button type="submit" disabled={busy || locked}>
          {busy ? 'Saving…' : event ? 'Save changes' : 'Create draft'}
        </Button>
      </fieldset>
    </form>
  );
}
