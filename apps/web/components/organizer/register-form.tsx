'use client';

import { registerOrganizerSchema, type SessionUser } from '@ticketpay/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { ApiError, apiFetch } from '@/lib/api';
import { Button } from '../ui';

type Field = { name: string; label: string; type?: string; autoComplete?: string; textarea?: boolean; optional?: boolean; hint?: string };

const SECTIONS: { title: string; fields: Field[] }[] = [
  {
    title: 'Your organization',
    fields: [
      { name: 'businessName', label: 'Organizer or business name', autoComplete: 'organization' },
      { name: 'organizerType', label: 'Organizer type', hint: 'For example: event promoter, campus organization, conference organizer' },
      { name: 'address', label: 'Address', autoComplete: 'street-address' },
      { name: 'description', label: 'About your organization', textarea: true, optional: true },
    ],
  },
  {
    title: 'Contact and login',
    fields: [
      { name: 'contactPerson', label: 'Contact person' },
      { name: 'fullName', label: 'Your full name', autoComplete: 'name' },
      { name: 'email', label: 'Email', type: 'email', autoComplete: 'email' },
      { name: 'phone', label: 'Phone', type: 'tel', autoComplete: 'tel' },
      { name: 'password', label: 'Password', type: 'password', autoComplete: 'new-password', hint: 'At least 8 characters' },
    ],
  },
  {
    title: 'Settlement (optional)',
    fields: [
      {
        name: 'settlementAccountNote',
        label: 'Settlement note',
        optional: true,
        hint: 'For example your bank name. Do not enter account numbers: this prototype does not need them and no real funds are settled.',
      },
    ],
  },
];

/** Organizer onboarding (brief section 6.1). The new merchant waits for an administrator's approval. */
export function OrganizerRegisterForm() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.currentTarget).entries()) as Record<string, string>;
    for (const k of ['description', 'settlementAccountNote']) if (!data[k]?.trim()) delete data[k];
    const parsed = registerOrganizerSchema.safeParse(data);
    if (!parsed.success) {
      setFieldErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
      setError('Check the highlighted fields.');
      return;
    }
    setBusy(true);
    setError(null);
    setFieldErrors({});
    try {
      await apiFetch<{ user: SessionUser }>('/v1/auth/register-organizer', { method: 'POST', body: data });
      router.push('/organizer');
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.status === 429 ? 'Too many attempts. Wait a minute and try again.' : err.message === 'Validation failed' ? 'Check the highlighted fields.' : err.message);
        setFieldErrors(Object.fromEntries(err.fieldErrors.map((f) => [f.field, f.message])));
      } else setError('Cannot reach the TicketPay API. Check that it is running on port 4000.');
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="card mx-auto w-full max-w-2xl space-y-8 p-8 shadow-card">
      <div className="space-y-2">
        <h1 className="text-h2">Register as an organizer</h1>
        <p className="text-body-sm text-ink-secondary">
          Tell us about your organization. A TicketPay administrator reviews new organizers; you can prepare events straight away and publish once approved.
        </p>
      </div>
      {error && (
        <p role="alert" className="rounded-md bg-status-danger-soft px-4 py-3 text-body-sm">
          {error}
        </p>
      )}
      {SECTIONS.map((s) => (
        <fieldset key={s.title} className="space-y-4">
          <legend className="mb-2 text-title">{s.title}</legend>
          {s.fields.map((f) => (
            <div key={f.name}>
              <label htmlFor={f.name} className="field-label">
                {f.label}
                {f.optional && <span className="font-normal text-ink-muted"> (optional)</span>}
              </label>
              {f.textarea ? (
                <textarea id={f.name} name={f.name} rows={3} className="field" aria-invalid={!!fieldErrors[f.name]} />
              ) : (
                <input id={f.name} name={f.name} type={f.type ?? 'text'} autoComplete={f.autoComplete} className="field" aria-invalid={!!fieldErrors[f.name]} />
              )}
              {f.hint && <p className="mt-1 text-caption text-ink-muted">{f.hint}</p>}
              {fieldErrors[f.name] && <p className="mt-2 text-caption text-status-danger">{fieldErrors[f.name]}</p>}
            </div>
          ))}
        </fieldset>
      ))}
      <Button type="submit" disabled={busy} className="w-full">
        {busy ? 'Creating account…' : 'Create organizer account'}
      </Button>
      <p className="text-center text-body-sm text-ink-secondary">
        Already registered?{' '}
        <Link href="/login?next=/organizer" className="text-ink-accent hover:underline">
          Log in
        </Link>
      </p>
    </form>
  );
}
