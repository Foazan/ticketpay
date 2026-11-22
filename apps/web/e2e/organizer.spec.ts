// Organizer dashboard in a real browser: onboarding, creating an event with a ticket category,
// publishing it and seeing it on sale in the marketplace.
import { expect, test, type Page } from '@playwright/test';

const PASSWORD = 'TicketPay123!';

async function login(page: Page, email: string, next: string) {
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Log in' }).click();
  await page.waitForURL((url) => url.pathname === next);
}

test('a new organizer registers, sees the approval notice and can prepare a draft but not publish', async ({ page }) => {
  await page.goto('/sell');
  await page.getByRole('link', { name: 'Register as an organizer' }).click();
  await page.getByLabel('Organizer or business name').fill('Kolektif Bunyi Kota');
  await page.getByLabel('Organizer type').fill('Community organizer');
  await page.getByLabel('Address').fill('Jl. Soekarno Hatta 9, Malang');
  await page.getByLabel('Contact person').fill('Bima Prasetyo');
  await page.getByLabel('Your full name').fill('Bima Prasetyo');
  await page.getByLabel('Email').fill(`bima.${Date.now()}@kolektif.example`);
  await page.getByLabel('Phone').fill('081355550000');
  await page.getByLabel('Password').fill('KolektifBunyi123!');
  await page.getByRole('button', { name: 'Create organizer account' }).click();
  await page.waitForURL((url) => url.pathname === '/organizer');
  await expect(page.getByText(/waiting for approval by TicketPay/)).toBeVisible();

  await page.getByRole('link', { name: 'Create event' }).first().click();
  await page.getByLabel('Event name').fill('Kolektif Open Mic');
  await page.getByLabel('Category').selectOption({ label: 'Community Event' });
  await page.getByLabel('City').fill('Malang');
  await page.getByLabel('Venue').fill('Ruang Kolektif');
  await page.getByLabel('Starts (WIB)').fill('2027-03-06T19:00');
  await page.getByLabel('Ends (WIB)').fill('2027-03-06T22:00');
  await page.getByLabel('Description').fill('Open mic night for poets and acoustic acts, with a short workshop beforehand.');
  await page.getByRole('button', { name: 'Create draft' }).click();
  await expect(page.getByText('Draft created.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Publish' })).toBeDisabled();
  await expect(page.getByText('Publishing becomes available once TicketPay approves your organizer account.')).toBeVisible();
});

test('an approved organizer creates an event, adds a ticket category, publishes it and it goes on sale', async ({ page }) => {
  await login(page, 'organizer@ticketpay.example', '/organizer');
  const title = `Rooftop Jazz ${Date.now().toString(36)}`;
  await page.getByRole('link', { name: 'Create event' }).first().click();
  // Browser validation mirrors the API: a bad form is stopped before it is sent.
  await page.getByRole('button', { name: 'Create draft' }).click();
  await expect(page.getByText('Check the highlighted fields.')).toBeVisible();

  await page.getByLabel('Event name').fill(title);
  await page.getByLabel('Category').selectOption({ label: 'Music & Concert' });
  await page.getByLabel('City').fill('Malang');
  await page.getByLabel('Venue').fill('Hotel Tugu Rooftop');
  await page.getByLabel('Starts (WIB)').fill('2027-04-10T19:00');
  await page.getByLabel('Ends (WIB)').fill('2027-04-10T23:00');
  await page.getByLabel('Description').fill('Three jazz trios on a rooftop above the city, with a sunset opening set.');
  await page.getByRole('button', { name: 'Create draft' }).click();
  await expect(page.getByText('Draft created.')).toBeVisible();

  await page.getByRole('button', { name: 'Add ticket category' }).click();
  await page.getByLabel('Category name').fill('Rooftop Standing');
  await page.getByLabel('Price (Rp)').fill('500');
  await page.getByLabel('Quota').fill('120');
  await page.getByRole('button', { name: 'Add category' }).click();
  await expect(page.getByText(/minimum price/)).toBeVisible();
  await page.getByLabel('Price (Rp)').fill('175000');
  await page.getByRole('button', { name: 'Add category' }).click();
  await expect(page.getByText('0 / 120')).toBeVisible();

  await page.getByRole('button', { name: 'Publish' }).click();
  await expect(page.getByText('On sale').first()).toBeVisible();
  await page.getByRole('link', { name: 'View public page →' }).click();
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  await expect(page.getByText('Rooftop Standing').first()).toBeVisible();

  await page.goto('/organizer/events');
  await expect(page.getByRole('link', { name: new RegExp(title) })).toBeVisible();
});
