// Gate flow in a real browser: the buyer's rotating QR, camera scanning (fed by a fake camera that
// shows the real QR), admission, the already-used result and the manual code fallback.
import { chromium, expect, request, test, type APIRequestContext, type Cookie, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import QRCode from 'qrcode';

const API = process.env.API_URL ?? 'http://localhost:4000';
const PASSWORD = 'TicketPay123!';
const BUYER = 'buyer@ticketpay.example';
const GATE = 'gate@ticketpay.example';
const CSRF = { 'x-ticketpay-csrf': '1' };

type Ticket = { id: string; status: string; eventSlug: string; validationCode?: string };

async function apiAs(email: string): Promise<APIRequestContext> {
  const ctx = await request.newContext({ baseURL: API, extraHTTPHeaders: CSRF });
  const res = await ctx.post('/v1/auth/login', { data: { email, password: PASSWORD } });
  expect(res.ok()).toBeTruthy();
  return ctx;
}

/** Buys and pays for fresh Soundwave tickets through the API, so the test does not depend on earlier runs. */
async function buyTickets(api: APIRequestContext, quantity: number): Promise<Ticket[]> {
  const event = await (await api.get('/v1/events/soundwave-festival-2026')).json();
  const tier = event.tiers.find((t: { name: string }) => t.name === 'Regular');
  const order = await (
    await api.post('/v1/orders', {
      data: { eventSlug: event.slug, items: [{ tierId: tier.id, quantity }], checkoutKey: crypto.randomUUID(), buyerName: 'Rania Putri', buyerEmail: BUYER },
    })
  ).json();
  const payment = await (await api.post('/v1/payments', { data: { orderId: order.id, method: 'VA' }, headers: { 'Idempotency-Key': crypto.randomUUID() } })).json();
  expect((await api.post(`/v1/dev/mock-payments/${payment.id}/simulate`, { data: { outcome: 'paid' } })).ok()).toBeTruthy();
  const all: Ticket[] = await (await api.get('/v1/tickets')).json();
  const active = all.filter((t) => t.status === 'ACTIVE' && t.eventSlug === 'soundwave-festival-2026');
  return Promise.all(active.slice(0, quantity).map(async (t) => (await api.get(`/v1/tickets/${t.id}`)).json()));
}

// Logins are rate limited (10 a minute per address) and the whole browser suite shares one address,
// so each account signs in through the form once and later tests reuse its session cookie.
const sessions = new Map<string, Cookie[]>();

async function login(page: Page, email: string, next: string) {
  const saved = sessions.get(email);
  if (saved) {
    await page.context().addCookies(saved);
    await page.goto(next);
    return;
  }
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Log in' }).click();
  await page.waitForURL((url) => url.pathname === next);
  sessions.set(email, (await page.context().cookies()).filter((c) => c.name === 'tp_session'));
}

async function openScanner(page: Page) {
  await login(page, GATE, '/gate');
  await page.getByRole('link', { name: /Soundwave Festival 2026/ }).click();
  await expect(page.getByRole('heading', { name: 'Soundwave Festival 2026' })).toBeVisible();
}

const result = (page: Page) => page.locator('[data-outcome]');

// One API session for the buyer: logins are rate limited (10 a minute per address).
let buyerApi: APIRequestContext;
test.beforeAll(async () => {
  buyerApi = await apiAs(BUYER);
});
test.afterAll(async () => {
  await buyerApi?.dispose();
});

test('the buyer sees a rotating entry QR with a manual code', async ({ page }) => {
  const api = buyerApi;
  const [ticket] = await buyTickets(api, 1);
  await login(page, BUYER, '/buyer/tickets');
  await page.goto(`/buyer/tickets/${ticket.id}`);
  await expect(page.getByRole('img', { name: /Entry QR code/ })).toBeVisible();
  await expect(page.getByText(ticket.validationCode!)).toBeVisible();
  await expect(page.getByText(/New code in \d+s/)).toBeVisible();
});

test('gate staff scan a QR with the camera, admit once, and a second scan is rejected', async () => {
  const api = buyerApi;
  const [ticket] = await buyTickets(api, 1);
  const { qr } = await (await api.get(`/v1/tickets/${ticket.id}/qr`)).json();

  // A fake camera that shows the QR the buyer's phone would display.
  const dir = mkdtempSync(join(tmpdir(), 'tp-qr-'));
  await QRCode.toFile(join(dir, 'qr.png'), qr, { width: 360, margin: 4 });
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-loop', '1', '-i', join(dir, 'qr.png'), '-vf', 'pad=640:480:(ow-iw)/2:(oh-ih)/2:white,format=yuv420p', '-t', '2', '-r', '10', join(dir, 'qr.y4m')]);
  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROME_PATH || undefined,
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${join(dir, 'qr.y4m')}`],
  });
  try {
    const page = await (await browser.newContext({ baseURL: process.env.WEB_URL ?? 'http://localhost:3000', viewport: { width: 1280, height: 900 } })).newPage();
    await openScanner(page);
    await expect(result(page)).toHaveAttribute('data-outcome', 'VALID', { timeout: 15_000 });
    await expect(result(page)).toContainText('Rania Putri');
    await expect(result(page)).toContainText('Regular');
    // Soundwave requires a photo ID check: Admit stays off until staff confirm it.
    await expect(page.getByRole('button', { name: 'Admit', exact: true })).toBeDisabled();
    await page.getByLabel(/I checked a photo ID/).check();
    await page.getByRole('button', { name: 'Admit', exact: true }).click();
    await expect(result(page)).toHaveAttribute('data-outcome', 'ADMITTED');
    // The same QR is still in front of the camera.
    await page.getByRole('button', { name: 'Scan next ticket' }).click();
    await expect(result(page)).toHaveAttribute('data-outcome', 'ALREADY_REDEEMED', { timeout: 15_000 });
    await expect(result(page)).toContainText('Gate Staff Satu');
  } finally {
    await browser.close();
  }
  const after = await (await api.get(`/v1/tickets/${ticket.id}`)).json();
  expect(after.status).toBe('REDEEMED');
});

test('the manual code works without a camera, and the required ID check cannot be skipped', async ({ page }) => {
  const api = buyerApi;
  const [ticket] = await buyTickets(api, 1);
  await openScanner(page);
  const code = page.getByLabel('Manual code');

  await code.fill('TP-0000-0000');
  await page.getByRole('button', { name: 'Check' }).click();
  await expect(result(page)).toHaveAttribute('data-outcome', 'INVALID');
  await page.getByRole('button', { name: 'Scan next ticket' }).click();

  // Required by the organizer, so it is a notice rather than a switch staff could turn off.
  await expect(page.getByText('Photo ID check required').first()).toBeVisible();
  await expect(page.getByLabel(/Also check a photo ID/)).toHaveCount(0);
  await code.fill(ticket.validationCode!.toLowerCase());
  await page.getByRole('button', { name: 'Check' }).click();
  await expect(result(page)).toHaveAttribute('data-outcome', 'VALID');
  const admit = page.getByRole('button', { name: 'Admit', exact: true });
  await expect(admit).toBeDisabled();
  await page.getByLabel(/I checked a photo ID/).check();
  await admit.click();
  await expect(result(page)).toHaveAttribute('data-outcome', 'ADMITTED');
  await page.getByRole('button', { name: 'Scan next ticket' }).click();

  await code.fill(ticket.validationCode!);
  await page.getByRole('button', { name: 'Check' }).click();
  await expect(result(page)).toHaveAttribute('data-outcome', 'ALREADY_REDEEMED');

  // The buyer's ticket now shows as used, under its own section.
  const buyer = await page.context().browser()!.newContext({ baseURL: process.env.WEB_URL ?? 'http://localhost:3000' });
  const buyerPage = await buyer.newPage();
  await login(buyerPage, BUYER, '/buyer/tickets');
  await expect(buyerPage.getByRole('heading', { name: /^Used/ })).toBeVisible();
  await buyerPage.goto(`/buyer/tickets/${ticket.id}`);
  await expect(buyerPage.getByText('This ticket was used to enter the event.')).toBeVisible();
  await expect(buyerPage.getByRole('img', { name: /Entry QR code/ })).toHaveCount(0);
  await buyer.close();
});

/** A fictional, KTP-style card rendered in the browser (no real person's data). */
async function idCardPhoto(page: Page, name: string): Promise<Buffer> {
  const card = await page.context().newPage();
  await card.setContent(`
    <div id="card" style="width:860px;padding:28px 36px;background:#dbeaf7;font:bold 26px Arial,sans-serif;color:#111;line-height:1.55">
      <div style="text-align:center">PROVINSI JAWA TIMUR<br>KOTA MALANG</div>
      <div style="margin-top:14px">NIK : 3573000000000001</div>
      <div>Nama : ${name}</div>
      <div>Tempat/Tgl Lahir : MALANG, 01-01-2001</div>
      <div>Jenis Kelamin : PEREMPUAN</div>
      <div>Alamat : JL. CONTOH NO. 1</div>
      <div style="margin-top:10px;font-size:16px">SPECIMEN FOR TESTING - FICTIONAL</div>
    </div>`);
  const png = await card.locator('#card').screenshot();
  await card.close();
  return png;
}

test('gate staff can read the name from a photo of the ID card, on the phone only', async ({ page }) => {
  test.slow(); // the first read loads the OCR engine
  const [ticket] = await buyTickets(buyerApi, 1);
  await openScanner(page);
  await page.getByLabel('Manual code').fill(ticket.validationCode!);
  await page.getByRole('button', { name: 'Check' }).click();
  await expect(result(page)).toHaveAttribute('data-outcome', 'VALID');

  const uploads: string[] = [];
  page.on('request', (r) => {
    if (r.method() !== 'GET' && !r.url().includes('/v1/gate/')) uploads.push(r.url());
  });
  const scan = page.locator('[data-id-scan]');
  const reader = page.getByLabel('Read name from ID card');

  // Someone else's card: flagged.
  await reader.setInputFiles({ name: 'id.png', mimeType: 'image/png', buffer: await idCardPhoto(page, 'BIMA SANTOSO') });
  await expect(scan).toHaveAttribute('data-id-scan', 'NO_MATCH', { timeout: 90_000 });
  await expect(scan.getByText('Name does not match')).toBeVisible();

  // The holder's card: matches, shows only the name (never the NIK), and staff still confirm.
  await page.getByLabel('Read another photo').setInputFiles({ name: 'id.png', mimeType: 'image/png', buffer: await idCardPhoto(page, 'RANIA PUTRI') });
  await expect(scan).toHaveAttribute('data-id-scan', 'MATCH', { timeout: 60_000 });
  await expect(scan.getByText('RANIA PUTRI', { exact: true })).toBeVisible();
  await expect(page.getByText('3573000000000001')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Admit', exact: true })).toBeDisabled();
  await page.getByLabel(/I checked a photo ID/).check();
  await page.getByRole('button', { name: 'Admit', exact: true }).click();
  await expect(result(page)).toHaveAttribute('data-outcome', 'ADMITTED');

  // The photo was never sent anywhere: the only writes were the gate check and admission.
  expect(uploads).toEqual([]);
});
