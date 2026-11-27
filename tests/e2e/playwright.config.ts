import { defineConfig, devices } from '@playwright/test';

/**
 * E2E against the running compose stack (`docker compose -f ops/docker-compose.yml up -d`).
 * Every test creates its own claims through the API (Test Plan §5: no reliance on seeded randomness).
 * Browser: installed Microsoft Edge by default (`msedge` channel) because browser downloads may be blocked;
 * set PW_CHANNEL= (empty) to use Playwright's bundled Chromium instead.
 */
const channel = process.env.PW_CHANNEL === undefined ? 'msedge' : process.env.PW_CHANNEL || undefined;

export default defineConfig({
  testDir: './specs',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    acceptDownloads: true,
    timezoneId: 'Asia/Kolkata',
    locale: 'en-IN',
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Edge'], channel, viewport: { width: 1366, height: 860 } },
    },
    {
      name: 'mobile-360',
      use: { ...devices['Desktop Edge'], channel, viewport: { width: 360, height: 780 }, hasTouch: true },
    },
  ],
});
