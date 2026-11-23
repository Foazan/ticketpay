import type { Metadata } from 'next';
import { PageHeader } from '@/components/organizer/page-header';
import { ApiKeys, ProfileForm, WebhookForm } from '@/components/organizer/settings-forms';
import { Badge } from '@/components/ui';
import { API_URL, serverFetch } from '@/lib/api';
import type { ApiKey, Integration, MerchantProfile } from '@/lib/organizer';
import { cookieHeader } from '@/lib/session';

export const metadata: Metadata = { title: 'Merchant settings' };

function Check({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <li className="flex items-center justify-between gap-3 py-2">
      <span>{children}</span>
      <Badge tone={ok ? 'success' : 'neutral'}>{ok ? 'Ready' : 'Not set up'}</Badge>
    </li>
  );
}

export default async function Settings() {
  const cookies = await cookieHeader();
  const [profile, integration, keys] = await Promise.all([
    serverFetch<MerchantProfile>('/v1/organizer/merchant', cookies),
    serverFetch<Integration>('/v1/organizer/integration', cookies),
    serverFetch<ApiKey[]>('/v1/organizer/api-keys', cookies),
  ]);
  const approved = profile.status === 'APPROVED';
  const d = integration.deliveriesLast7Days;
  return (
    <>
      <PageHeader title="Merchant settings" intro="Your organizer profile, and the API keys and webhook your own systems use to work with TicketPay payments." />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-6">
          <section className="card space-y-4 p-6" aria-labelledby="profile-heading">
            <div className="flex items-center justify-between gap-3">
              <h2 id="profile-heading" className="text-title">
                Profile
              </h2>
              <Badge tone={approved ? 'success' : profile.status === 'PENDING' ? 'pending' : 'failed'}>{profile.status.toLowerCase()}</Badge>
            </div>
            {profile.statusReason && <p className="text-body-sm text-ink-secondary">Note from TicketPay: {profile.statusReason}</p>}
            <ProfileForm profile={profile} />
          </section>
          <section className="card space-y-4 p-6" aria-labelledby="keys-heading">
            <h2 id="keys-heading" className="text-title">
              API keys
            </h2>
            <p className="text-body-sm text-ink-secondary">Your server sends a key as a Bearer token to create and read payments for your own orders. Only a masked version is ever shown after creation.</p>
            <ApiKeys keys={keys} approved={approved} />
          </section>
          <section className="card space-y-4 p-6" aria-labelledby="webhook-heading">
            <h2 id="webhook-heading" className="text-title">
              Webhook
            </h2>
            <p className="text-body-sm text-ink-secondary">TicketPay POSTs payment.paid, payment.failed and payment.expired to this URL, signed with your secret, and retries with backoff until your server answers 2xx.</p>
            <WebhookForm url={profile.webhookUrl} hasSecret={profile.hasWebhookSecret} />
          </section>
        </div>
        <div className="space-y-6">
          <section className="card space-y-3 p-6" aria-labelledby="integration-heading">
            <h2 id="integration-heading" className="text-title">
              Integration status
            </h2>
            <ul className="divide-y divide-line text-body-sm">
              <Check ok={integration.activeApiKeys > 0}>
                {integration.activeApiKeys} active API {integration.activeApiKeys === 1 ? 'key' : 'keys'}
              </Check>
              <Check ok={integration.webhookConfigured}>Webhook URL</Check>
              <Check ok={integration.webhookSecretSet}>Signing secret</Check>
            </ul>
            <p className="text-body-sm text-ink-secondary">
              Last 7 days: {d.delivered} of {d.total} webhook deliveries succeeded{d.failed ? `, ${d.failed} failed after all retries` : ''}.
            </p>
          </section>
          <section className="card space-y-3 p-6" aria-labelledby="help-heading">
            <h2 id="help-heading" className="text-title">
              Developer help
            </h2>
            <p className="text-body-sm text-ink-secondary">Create a payment for one of your orders:</p>
            <pre className="overflow-x-auto rounded-md bg-brand-navy p-3 text-caption text-ink-inverse">{`curl -X POST ${API_URL || '<your TicketPay address>'}/v1/payments \\
  -H "Authorization: Bearer <api key>" \\
  -H "Idempotency-Key: <unique id>" \\
  -H "Content-Type: application/json" \\
  -d '{"orderId":"<order id>","method":"QRIS"}'`}</pre>
            <p className="text-body-sm text-ink-secondary">Verify a webhook on the raw body before parsing it:</p>
            <pre className="overflow-x-auto rounded-md bg-brand-navy p-3 text-caption text-ink-inverse">{`expected = "v1=" + HMAC_SHA256(secret,
  timestamp + "." + rawBody)
compare with header x-ticketpay-signature
reject if |now - timestamp| > 300 s`}</pre>
            <p className="text-caption text-ink-muted">Sandbox only. TicketPay is an academic prototype, not a licensed payment provider; no real money moves.</p>
          </section>
        </div>
      </div>
    </>
  );
}
