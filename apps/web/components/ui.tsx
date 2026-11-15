import clsx from 'clsx';
import Link from 'next/link';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variant = 'primary' | 'accent' | 'secondary' | 'ghost' | 'danger';

const variants: Record<Variant, string> = {
  primary: 'bg-brand-navy text-ink-inverse hover:bg-brand-navy-700',
  accent: 'bg-accent-teal text-ink-inverse hover:brightness-95',
  secondary: 'bg-bg-surface text-ink-primary border border-line hover:bg-bg-muted',
  ghost: 'text-ink-accent hover:bg-accent-teal-soft',
  danger: 'bg-status-danger text-ink-inverse hover:brightness-95',
};

const base = 'inline-flex items-center justify-center gap-2 rounded-md px-6 py-3 text-label transition disabled:cursor-not-allowed disabled:opacity-60';

export function Button({ variant = 'primary', className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return <button className={clsx(base, variants[variant], className)} {...props} />;
}

export function ButtonLink({ href, variant = 'primary', className, children }: { href: string; variant?: Variant; className?: string; children: ReactNode }) {
  return (
    <Link href={href} className={clsx(base, variants[variant], className)}>
      {children}
    </Link>
  );
}

type Tone = 'success' | 'pending' | 'failed' | 'info' | 'neutral';
const tones: Record<Tone, string> = {
  success: 'bg-status-success-soft text-ink-primary',
  pending: 'bg-status-warning-soft text-ink-primary',
  failed: 'bg-status-danger-soft text-ink-primary',
  info: 'bg-status-info-soft text-ink-primary',
  neutral: 'bg-bg-muted text-ink-secondary',
};

export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={clsx('inline-flex items-center rounded-full px-3 py-1 text-caption', tones[tone])}>{children}</span>;
}

export function EmptyState({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="card flex flex-col items-center gap-3 px-6 py-16 text-center">
      <h2 className="text-h3">{title}</h2>
      <p className="max-w-md text-body-sm text-ink-secondary">{body}</p>
      {action}
    </div>
  );
}
