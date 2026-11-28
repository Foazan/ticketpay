// A buyer signs up, corrects their name to match their ID and changes their password.
import { expect, test } from '@playwright/test';

test('a buyer edits their name and changes their password from the account page', async ({ page }) => {
  const email = `akun.${Date.now().toString(36)}@ticketpay.example`;
  await page.goto('/register');
  await page.getByLabel('Full name').fill('Budi');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('AkunUji12345');
  await page.getByRole('button', { name: 'Create account' }).click();
  // Signing up loads the home page in full; under `pnpm dev` its first compile can be slow.
  await expect(page.getByRole('link', { name: 'Budi', exact: true })).toBeVisible({ timeout: 30_000 });

  await page.getByRole('link', { name: 'Budi', exact: true }).click();
  await expect(page).toHaveURL(/\/account$/);
  await expect(page.getByRole('heading', { name: 'Account' })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByLabel('Email')).toHaveValue(email);

  await page.getByLabel('Full name').fill('Budi Santoso Wijaya');
  await expect(page.getByText(/show the new name at the gate/)).toBeVisible();
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Save details' }).click();
  await expect(page.getByText('Your details are saved.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Budi Santoso Wijaya' })).toBeVisible();
  await expect(page.getByText(/name last changed/)).toBeVisible();

  await page.getByLabel('Current password').fill('wrong-password');
  await page.getByLabel('New password', { exact: true }).fill('AkunBaru12345');
  await page.getByLabel('Repeat new password').fill('AkunBaru12345');
  await page.getByRole('button', { name: 'Change password' }).click();
  await expect(page.getByText('The current password is incorrect')).toBeVisible();

  await page.getByLabel('Current password').fill('AkunUji12345');
  await page.getByRole('button', { name: 'Change password' }).click();
  await expect(page.getByText(/Password changed/)).toBeVisible();
  // Still signed in here with the refreshed session.
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Account' })).toBeVisible();
});
