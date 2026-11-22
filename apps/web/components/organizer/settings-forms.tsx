'use client';

import { merchantProfileSchema } from '@ticketpay/shared';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ApiError, apiFetch } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import type { ApiKey, MerchantProfile } from '@/lib/organizer';
import { Badge, Button } from '../ui';

function Alert({ kind, children }: { kind: 'error' | 'ok'; children: React.ReactNode }) {
  return (
    <p role={kind === 'error' ? 'alert' : 'status'} className={`rounded-md px-4 py-3 text-body-sm ${kind === 'error' ? 'bg-status-danger-soft' : 'bg-status-success-soft'}`}>
      {children}
    </p>
  );
}

/** A secret shown exactly once, with a copy button. It is never retrievable again. */
function OneTimeSecret({ label, value, notice }: { label: string; value: string; notice: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-2 rounded-md border-2 border-status-warning bg-status-warning-soft p-4">
      <p className="text-label">{label}</p>
      <div className="flex gap-2">
        <code className="min-w-0 flex-1 break-all rounded-sm bg-bg-surface px-3 py-2 text-caption">{value}</code>
        <Button
          type="button"
          variant="secondary"
          className="px-3 py-2"
          onClick={async () => {
            await navigator.clipboard.writeText(value).catch(() => undefined);
            setCopied(true);
          }}
        >
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
      <p className="text-caption">{notice}</p>
    </div>
  );
}

export function ProfileForm({ profile }: { profile: MerchantProfile }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const body = Object.fromEntries(['contactPerson', 'phone', 'address', 'description', 'settlementAccountNote'].map((k) => [k, String(f.get(k) ?? '')]));
    const parsed = merchantProfileSchema.safeParse(body);
    if (!parsed.success) {
      setFieldErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
      return;
    }
    setBusy(true);
    setError(null);
    setSaved(false);
    setFieldErrors({});
    try {
      await apiFetch('/v1/organizer/merchant', { method: 'PATCH', body });
      setSaved(true);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reach the server.');
    } finally {
      setBusy(false);
    }
  };

  const field = (name: keyof MerchantProfile, label: string, opts: { textarea?: boolean; hint?: string } = {}) => (
    <div>
      <label htmlFor={name} className="field-label">
        {label}
      </label>
      {opts.textarea ? (
        <textarea id={name} name={name} rows={3} className="field" defaultValue={(profile[name] as string) ?? ''} aria-invalid={!!fieldErrors[name]} />
      ) : (
        <input id={name} name={name} className="field" defaultValue={(profile[name] as string) ?? ''} aria-invalid={!!fieldErrors[name]} />
      )}
      {opts.hint && <p className="mt-1 text-caption text-ink-muted">{opts.hint}</p>}
      {fieldErrors[name] && <p className="mt-2 text-caption text-status-danger">{fieldErrors[name]}</p>}
    </div>
  );

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      {error && <Alert kind="error">{error}</Alert>}
      {saved && <Alert kind="ok">Profile saved.</Alert>}
      <dl className="grid gap-4 text-body-sm sm:grid-cols-2">
        <div>
          <dt className="text-ink-secondary">Business name</dt>
          <dd className="text-label">{profile.businessName}</dd>
        </div>
        <div>
          <dt className="text-ink-secondary">Organizer type</dt>
          <dd className="text-label">{profile.organizerType}</dd>
        </div>
      </dl>
      <p className="text-caption text-ink-muted">The business name and type are part of your approval; ask TicketPay to change them.</p>
      <div className="grid gap-4 sm:grid-cols-2">
        {field('contactPerson', 'Contact person')}
        {field('phone', 'Phone')}
      </div>
      {field('address', 'Address')}
      {field('description', 'About your organization', { textarea: true })}
      {field('settlementAccountNote', 'Settlement note (optional)', { hint: 'For example the bank name. Never enter account numbers: this prototype does not need them.' })}
      <Button type="submit" disabled={busy}>
        {busy ? 'Saving…' : 'Save profile'}
      </Button>
    </form>
  );
}

export function WebhookForm({ url, hasSecret }: { url: string | null; hasSecret: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [secret, setSecret] = useState<{ value: string; notice: string } | null>(null);

  const save = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const value = String(new FormData(e.currentTarget).get('webhookUrl') ?? '').trim();
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const res = await apiFetch<{ url: string | null; webhookSecret?: string; notice?: string }>('/v1/organizer/webhook', { method: 'PUT', body: { url: value || null } });
      if (res.webhookSecret) setSecret({ value: res.webhookSecret, notice: res.notice ?? '' });
      setSaved(true);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reach the server.');
    } finally {
      setBusy(false);
    }
  };

  const rotate = async () => {
    if (!window.confirm('Create a new webhook secret? Deliveries are signed with the new one straight away, so update your server first.')) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch<{ webhookSecret: string; notice: string }>('/v1/organizer/webhook-secret/rotate', { method: 'POST' });
      setSecret({ value: res.webhookSecret, notice: res.notice });
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reach the server.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <form onSubmit={save} className="space-y-3">
        {error && <Alert kind="error">{error}</Alert>}
        {saved && !secret && <Alert kind="ok">Webhook URL saved.</Alert>}
        <div>
          <label htmlFor="webhookUrl" className="field-label">
            Webhook URL
          </label>
          <input id="webhookUrl" name="webhookUrl" type="url" className="field" defaultValue={url ?? ''} placeholder="https://your-server.example/ticketpay/webhook" />
          <p className="mt-1 text-caption text-ink-muted">HTTPS only (http is allowed for localhost while developing). Leave empty to stop deliveries.</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button type="submit" disabled={busy}>
            Save URL
          </Button>
          {hasSecret && (
            <Button type="button" variant="secondary" disabled={busy} onClick={rotate}>
              Rotate signing secret
            </Button>
          )}
        </div>
      </form>
      <p className="text-body-sm text-ink-secondary">
        Signing secret: {hasSecret ? <Badge tone="success">Set</Badge> : <Badge>Not set</Badge>}{' '}
        <span className="text-caption text-ink-muted">Shown once when created or rotated, never again.</span>
      </p>
      {secret && <OneTimeSecret label="Your new webhook signing secret" value={secret.value} notice={secret.notice} />}
    </div>
  );
}

export function ApiKeys({ keys, approved }: { keys: ApiKey[]; approved: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ value: string; notice: string } | null>(null);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch<{ apiKey: string; notice: string }>('/v1/organizer/api-keys', { method: 'POST' });
      setCreated({ value: res.apiKey, notice: res.notice });
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reach the server.');
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (k: ApiKey) => {
    if (!window.confirm(`Revoke the key ${k.keyPrefix}…${k.lastFour}? Requests using it will stop working immediately.`)) return;
    setError(null);
    try {
      await apiFetch(`/v1/organizer/api-keys/${k.id}`, { method: 'DELETE' });
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reach the server.');
    }
  };

  return (
    <div className="space-y-4">
      {error && <Alert kind="error">{error}</Alert>}
      {created && <OneTimeSecret label="Your new API key" value={created.value} notice={created.notice} />}
      {keys.length === 0 ? (
        <p className="text-body-sm text-ink-secondary">No API keys yet.</p>
      ) : (
        <ul className="divide-y divide-line rounded-md border border-line">
          {keys.map((k) => (
            <li key={k.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div>
                <code className="text-caption">
                  {k.keyPrefix}.••••••••{k.lastFour}
                </code>
                <p className="text-caption text-ink-muted">Created {formatDateTime(k.createdAt)}</p>
              </div>
              {k.revokedAt ? (
                <Badge>Revoked {formatDateTime(k.revokedAt)}</Badge>
              ) : (
                <div className="flex items-center gap-2">
                  <Badge tone="success">Active</Badge>
                  <Button variant="ghost" className="px-3 py-2 text-status-danger" onClick={() => revoke(k)}>
                    Revoke
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      <Button variant="secondary" disabled={busy || !approved} onClick={create}>
        {busy ? 'Creating…' : 'Create API key'}
      </Button>
      {!approved && <p className="text-caption text-ink-secondary">API keys are available once your account is approved.</p>}
    </div>
  );
}
