// Admin dashboard in a real browser: approving an organizer, refunding a payment (simulated),
// changing the service fee and setting up a gate staff account. Setup purchases go through the API.
import { CSRF_HEADER, CSRF_HEADER_VALUE } from '@ticketpay/shared';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PASSWORD = 'TicketPay123!';
const csrf = { [CSRF_HEADER]: CSRF_HEADER_VALUE };
const tag = () => Date.now().toString(36);

// One sign-in for the whole file: login is rate limited to 10 a minute per client, and the
// other specs sign in too.
const STATE = join(tmpdir(), 'ticketpay-admin-state.json');
test.describe.configure({ mode: 'serial' });
test.use({ storageState: STATE });

test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext({ storageState: undefined });
  const page = await context.newPage();
  await page.goto('/login?next=/admin');
  await page.getByLabel('Email').fill('admin@ticketpay.example');
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Log in' }).click();
  await page.waitForURL((url) => url.pathname === '/admin');
  await context.storageState({ path: STATE });
  await context.close();
});

const open = (page: Page, path = '/admin') => page.goto(path);

/** A paid order for one Regular Soundwave ticket, bought by buyer2 through the API with the mock provider. */
async function paidPurchase(request: APIRequestContext) {
  expect((await request.post('/v1/auth/login', { headers: csrf, data: { email: 'buyer2@ticketpay.example', password: PASSWORD } })).ok()).toBe(true);
  const event = await (await request.get('/v1/events/soundwave-festival-2026')).json();
  const tier = event.tiers.find((t: { name: string }) => t.name === 'Regular');
  const order = await request.post('/v1/orders', {
    headers: csrf,
    data: { eventSlug: 'soundwave-festival-2026', items: [{ tierId: tier.id, quantity: 1 }], checkoutKey: crypto.randomUUID(), buyerName: 'Bima Santoso', buyerEmail: 'buyer2@ticketpay.example' },
  });
  expect(order.status()).toBe(201);
  const payment = await request.post('/v1/payments', { headers: { ...csrf, 'Idempotency-Key': crypto.randomUUID() }, data: { orderId: (await order.json()).id, method: 'QRIS' } });
  const p = await payment.json();
  expect((await request.post(`/v1/dev/mock-payments/${p.id}/simulate`, { headers: csrf, data: { outcome: 'paid' } })).ok()).toBe(true);
  return p as { id: string; reference: string };
}

test('an administrator reviews and approves a new organizer, and the decision is audited', async ({ page, request }) => {
  const name = `Sanggar Uji ${tag()}`;
  const reg = await request.post('/v1/auth/register-organizer', {
    headers: csrf,
    data: {
      fullName: 'Ayu Lestari',
      email: `ayu.${tag()}@sanggar.example`,
      password: 'SanggarUji123!',
      businessName: name,
      organizerType: 'Community organizer',
      contactPerson: 'Ayu Lestari',
      phone: '081366660000',
      address: 'Jl. Ijen 4, Malang',
    },
  });
  expect(reg.status()).toBe(201);

  await open(page);
  await expect(page.getByRole('link', { name: /organizer applications? awaits?/ })).toBeVisible();
  await page.getByRole('link', { name: 'Merchants' }).click();
  await page.getByRole('link', { name: 'Awaiting approval' }).click();
  await page.getByRole('link', { name }).click();
  await expect(page.getByRole('heading', { name })).toBeVisible();

  // Rejecting asks for a reason first; cancel it and approve instead.
  await page.getByRole('button', { name: 'Reject' }).click();
  await expect(page.getByLabel('Reason for rejecting')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();

  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByText('Approved', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Suspend' })).toBeVisible();
  await expect(page.getByText(/Approved by Platform Admin/)).toBeVisible();

  await page.getByRole('link', { name: 'Audit log' }).click();
  await expect(page.getByRole('cell', { name: 'merchant.approved' }).first()).toBeVisible();
});

test('an administrator refunds a paid order (simulated) and sees the reversal everywhere', async ({ page, request }) => {
  const payment = await paidPurchase(request);
  await open(page, '/admin/payments');
  await page.getByLabel('Search').fill(payment.reference);
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('link', { name: payment.reference }).click();
  await expect(page.getByRole('heading', { name: 'Rp154.500' })).toBeVisible();
  await expect(page.getByText('GROSS_SALE')).toBeVisible();

  await page.getByRole('button', { name: 'Refund (simulated)' }).click();
  await page.getByLabel('Reason for the refund').fill('Buyer can no longer attend');
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Refund (simulated)' }).click();

  await expect(page.getByText('Refunded').first()).toBeVisible();
  await expect(page.getByText('REFUND', { exact: true })).toBeVisible();
  await expect(page.getByText('cancelled', { exact: true })).toBeVisible();
  await expect(page.getByText('payment.refunded')).toBeVisible();

  await page.getByRole('link', { name: 'Reconciliation' }).click();
  const row = page.getByRole('row').filter({ hasText: payment.reference });
  await expect(row.getByText('Matched')).toBeVisible();
  await expect(row.getByText('refund Rp154.500')).toBeVisible();
});

test('an administrator changes the service fee, and new quotes use it', async ({ page, request }) => {
  await open(page, '/admin/fees');
  await page.getByLabel('New rate (%)').fill('2.5');
  await page.getByLabel('Note (optional)').fill('Playwright check');
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Save new rate' }).click();
  await expect(page.getByText('The service fee is now 2.5%.')).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Playwright check' })).toBeVisible();

  const event = await (await request.get('/v1/events/soundwave-festival-2026')).json();
  const quote = await (await request.get(`/v1/checkout/quote?event=soundwave-festival-2026&items=${event.tiers[0].id}:1`)).json();
  expect(quote).toMatchObject({ feeRateBps: 250, serviceFee: 3750 });

  // Back to the default so other tests see 3%.
  await page.goto('/admin/fees');
  await page.getByLabel('New rate (%)').fill('3');
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Save new rate' }).click();
  await expect(page.getByText('The service fee is now 3%.')).toBeVisible();
});

test('an administrator creates a gate staff account and assigns an event to it', async ({ page }) => {
  const email = `gate.${tag()}@ticketpay.example`;
  await open(page, '/admin/gate-staff');
  await page.getByLabel('Full name').fill('Gate Staff Uji');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Temporary password').fill('GateStaffUji123!');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByText(`Account created for ${email}.`)).toBeVisible();

  const card = page.getByRole('listitem').filter({ hasText: email });
  await expect(card.getByText('No events assigned')).toBeVisible();
  await card.getByLabel('Add an event').selectOption({ label: 'Soundwave Festival 2026' });
  await card.getByRole('button', { name: 'Assign' }).click();
  await expect(card.getByText('Soundwave Festival 2026')).toBeVisible();
  await card.getByRole('button', { name: 'Remove' }).click();
  await expect(card.getByText('No events assigned')).toBeVisible();
});
