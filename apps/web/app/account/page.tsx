import type { Account } from '@ticketpay/shared';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { PasswordForm, ProfileForm } from '@/components/account-forms';
import { serverFetch } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { cookieHeader, getSession } from '@/lib/session';

export const metadata: Metadata = { title: 'Account' };
export const dynamic = 'force-dynamic';

const ROLE_LABEL: Record<Account['role'], string> = {
  BUYER: 'Buyer account',
  ORGANIZER: 'Organizer account',
  GATE_STAFF: 'Gate staff account',
  ADMIN: 'Administrator account',
};

export default async function AccountPage() {
  const user = await getSession();
  if (!user) redirect('/login?next=/account');
  const account = await serverFetch<Account>('/v1/account', await cookieHeader());
  return (
    <div className="container-page max-w-3xl space-y-6 py-10">
      <div className="space-y-1">
        <h1 className="text-h1">Account</h1>
        <p className="text-body-sm text-ink-secondary">
          {ROLE_LABEL[account.role]} · since {formatDate(account.createdAt)}
          {account.nameChangedAt && ` · name last changed ${formatDate(account.nameChangedAt)}`}
        </p>
        {account.role === 'ORGANIZER' && <p className="text-body-sm text-ink-secondary">Your business profile is under Dashboard, Settings.</p>}
      </div>
      <ProfileForm account={account} />
      <PasswordForm />
    </div>
  );
}
