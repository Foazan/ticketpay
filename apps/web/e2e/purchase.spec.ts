import { expect, test, type Page } from '@playwright/test';

const BUYER = { email: 'buyer@ticketpay.example', password: 'TicketPay123!' };

async function login(page: Page, next: string) {
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel('Email').fill(BUYER.email);
  await page.getByLabel('Password').fill(BUYER.password);
  await page.getByRole('button', { name: 'Log in' }).click();
}

test('a visitor browses, logs in, buys two tickets with a demo payment and sees them in My Tickets', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Find your next live experience' })).toBeVisible();

  await page.goto('/events?city=Malang');
  // Five seeded events are in Malang; organizer tests may have added more.
  await expect(page.getByText(/\d+ events found/)).toBeVisible();
  await page.getByRole('link', { name: /Soundwave Festival 2026/ }).first().click();
  await expect(page.getByRole('heading', { level: 1, name: 'Soundwave Festival 2026' })).toBeVisible();

  await page.getByRole('button', { name: 'Add one Regular ticket' }).click();
  await page.getByRole('button', { name: 'Add one Regular ticket' }).click();
  await expect(page.getByText('Subtotal (2 tickets)')).toBeVisible();
  await page.getByRole('button', { name: 'Buy tickets' }).click();

  // Not logged in yet: checkout sends the buyer to login and back.
  await expect(page).toHaveURL(/\/login\?next=/);
  await page.getByLabel('Email').fill(BUYER.email);
  await page.getByLabel('Password').fill(BUYER.password);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page).toHaveURL(/\/checkout\?/);

  await expect(page.getByText('Demo mode.')).toBeVisible();
  await expect(page.getByText('Platform service fee (3%)')).toBeVisible();
  await expect(page.getByText('Rp309.000').first()).toBeVisible();
  await page.getByLabel(/QRIS/).check();
  await page.getByRole('button', { name: 'Pay Rp309.000' }).click();

  await expect(page).toHaveURL(/\/pay\/mock\//);
  await expect(page.getByText('DEMO PAYMENT — NOT A REAL PAYMENT PAGE')).toBeVisible();
  await page.getByRole('button', { name: 'Simulate successful payment' }).click();

  await expect(page).toHaveURL(/\/orders\/.+\/status/);
  await expect(page.getByRole('heading', { name: 'Payment verified' })).toBeVisible();
  await expect(page.getByText('2 issued')).toBeVisible();
  await page.getByRole('link', { name: 'View my tickets' }).click();

  await expect(page.getByRole('heading', { name: 'My Tickets' })).toBeVisible();
  // At least the two just bought (earlier runs may have left more).
  await expect(page.getByText('Soundwave Festival 2026').nth(1)).toBeVisible();
});

test('a failed demo payment shows the failure page and releases the tickets', async ({ page }) => {
  await login(page, '/events/indie-music-night');
  await page.waitForURL(/\/events\/indie-music-night/);
  const before = await page.getByText(/of 400 left/).textContent();
  await page.getByRole('button', { name: 'Add one Regular ticket' }).click();
  await page.getByRole('button', { name: 'Buy tickets' }).click();
  await page.getByRole('button', { name: /^Pay Rp/ }).click();
  await page.getByRole('button', { name: 'Simulate failure' }).click();
  await expect(page.getByRole('heading', { name: 'Payment failed' })).toBeVisible();
  await expect(page.getByText(/No ticket was issued/)).toBeVisible();
  await page.goto('/events/indie-music-night');
  await expect(page.getByText(/of 400 left/)).toHaveText(before!);
});

test('the payment status page cannot be faked from the URL', async ({ page }) => {
  await login(page, '/events/artspace-exhibition');
  await page.waitForURL(/\/events\/artspace-exhibition/);
  await page.getByRole('button', { name: 'Add one General Admission ticket' }).click();
  await page.getByRole('button', { name: 'Buy tickets' }).click();
  await page.getByRole('button', { name: /^Pay Rp/ }).click();
  await expect(page).toHaveURL(/\/pay\/mock\//);
  // Skip the payment and jump to the status page with a provider-style "success" query string.
  const orderLink = await page.evaluate(async () => {
    const id = location.pathname.split('/').pop();
    const res = await fetch(`/v1/payments/${id}`, { credentials: 'include' });
    return (await res.json()).orderId as string;
  });
  await page.goto(`/orders/${orderLink}/status?transaction_status=settlement&status_code=200`);
  await expect(page.getByRole('heading', { name: 'Waiting for payment' })).toBeVisible();
});

test('a ticket page shows its ownership record, and the NFT once minted when a chain is configured', async ({ page, request }) => {
  const health = await (await request.get('http://localhost:4000/v1/health')).json();
  await login(page, '/buyer/tickets');
  await expect(page.getByRole('heading', { name: 'My Tickets' })).toBeVisible();
  await page.getByRole('link', { name: /Soundwave Festival 2026/ }).first().click();
  await expect(page).toHaveURL(/\/buyer\/tickets\/[a-z0-9]+$/);
  await expect(page.getByRole('heading', { name: 'Ownership record' })).toBeVisible();
  if (health.chainMode === 'disabled') {
    await expect(page.getByText('Off-chain ticket')).toBeVisible();
    return;
  }
  // The page refreshes itself until the mint is confirmed.
  await expect(page.getByText(/^NFT #\d+ on /)).toBeVisible({ timeout: 45_000 });
  await expect(page.getByText('Mint transaction')).toBeVisible();
  await expect(page.getByText('Payment reference')).toBeVisible();
  // Never another buyer's ticket: an unknown id is a 404.
  await page.goto('/buyer/tickets/not-a-real-ticket');
  await expect(page.getByText(/not found|404/i).first()).toBeVisible();
});
