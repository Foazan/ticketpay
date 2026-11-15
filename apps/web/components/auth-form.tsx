'use client';

import { ROLE_HOME, type SessionUser } from '@ticketpay/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { ApiError, apiFetch } from '@/lib/api';
import { Button } from './ui';

type Field = { name: string; label: string; type?: string; placeholder?: string; autoComplete?: string };

const FIELDS: Record<'login' | 'register', Field[]> = {
  login: [
    { name: 'email', label: 'Email', type: 'email', placeholder: 'you@example.com', autoComplete: 'email' },
    { name: 'password', label: 'Password', type: 'password', placeholder: 'Enter your password', autoComplete: 'current-password' },
  ],
  register: [
    { name: 'fullName', label: 'Full name', placeholder: 'Your name as shown at the gate', autoComplete: 'name' },
    { name: 'email', label: 'Email', type: 'email', placeholder: 'you@example.com', autoComplete: 'email' },
    { name: 'phone', label: 'Phone (optional)', placeholder: '08xx xxxx xxxx', autoComplete: 'tel' },
    { name: 'password', label: 'Password', type: 'password', placeholder: 'At least 8 characters', autoComplete: 'new-password' },
  ],
};

export function AuthForm({ mode, next }: { mode: 'login' | 'register'; next?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setFieldErrors({});
    const data = Object.fromEntries(new FormData(e.currentTarget).entries()) as Record<string, string>;
    if (!data.phone) delete data.phone;
    try {
      const { user } = await apiFetch<{ user: SessionUser }>(`/v1/auth/${mode}`, { method: 'POST', body: data });
      // Only follow a same-site path, and only buyers go back to where they came from.
      const safeNext = next && next.startsWith('/') && !next.startsWith('//') ? next : null;
      router.push(user.role === 'BUYER' && safeNext ? safeNext : ROLE_HOME[user.role]);
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.status === 429 ? 'Too many attempts. Wait a minute and try again.' : err.message);
        setFieldErrors(Object.fromEntries(err.fieldErrors.map((f) => [f.field, f.message])));
      } else {
        setError('Cannot reach the TicketPay API. Check that it is running on port 4000.');
      }
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="card mx-auto flex w-full max-w-md flex-col gap-6 p-8 shadow-card" noValidate>
      <div className="space-y-2">
        <h1 className="text-h2">{mode === 'login' ? 'Log in to TicketPay' : 'Create your account'}</h1>
        <p className="text-body-sm text-ink-secondary">
          {mode === 'login' ? 'Access your tickets and orders.' : 'Buy tickets and keep them in one place.'}
        </p>
      </div>
      {error && (
        <p role="alert" className="rounded-md bg-status-danger-soft px-4 py-3 text-body-sm">
          {error}
        </p>
      )}
      {FIELDS[mode].map((f) => (
        <div key={f.name}>
          <label htmlFor={f.name} className="field-label">{f.label}</label>
          <input id={f.name} name={f.name} type={f.type ?? 'text'} placeholder={f.placeholder} autoComplete={f.autoComplete} className="field" aria-invalid={!!fieldErrors[f.name]} />
          {fieldErrors[f.name] && <p className="mt-2 text-caption text-status-danger">{fieldErrors[f.name]}</p>}
        </div>
      ))}
      <Button type="submit" disabled={busy}>{busy ? 'Please wait…' : mode === 'login' ? 'Log in' : 'Create account'}</Button>
      <div className="flex flex-col gap-2 text-body-sm text-ink-accent">
        {mode === 'login' ? (
          <>
            <Link href="/register">New to TicketPay? Create an account</Link>
            <Link href="/sell">Selling tickets? Register as an organizer</Link>
          </>
        ) : (
          <Link href="/login">Already have an account? Log in</Link>
        )}
      </div>
    </form>
  );
}
