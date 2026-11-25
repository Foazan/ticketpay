import { defineConfig } from '@playwright/test';

// Runs against an already running stack (pnpm dev, or the built apps): API on 4000, web on 3000,
// with PAYMENT_PROVIDER=mock and a freshly seeded database.
// Uses an installed Chrome when PLAYWRIGHT_CHROME_PATH is set; otherwise Playwright's own browser
// (install it once with: pnpm --filter @ticketpay/web exec playwright install chromium).
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  // Under `pnpm dev`, Next compiles a route on its first visit, which can take several seconds.
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.WEB_URL ?? 'http://localhost:3000',
    viewport: { width: 1280, height: 900 },
    screenshot: 'only-on-failure',
    launchOptions: process.env.PLAYWRIGHT_CHROME_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROME_PATH } : {},
  },
});
