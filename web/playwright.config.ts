import { defineConfig } from '@playwright/test';

/**
 * Golden E2E: real user flows against a locally started API + web app.
 * Email/OTP and FX are stubbed deterministically by e2e/api_server.py, the
 * browser and the Next.js server both run on a frozen clock, and every
 * request to a host other than localhost is aborted. No retries: a test
 * that can't pass first time is a bug to fix, not to retry.
 *
 *   npm run build   (with NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8100)
 *   E2E_DATABASE_URL=postgresql://… npx playwright test --project=chromium
 *   npx playwright test --project=firefox --project=webkit   # cross-browser
 *   npx playwright test --update-snapshots   # after an intended plan change
 */
// E2E_API_PORT / E2E_WEB_PORT let two checkouts run the suite side by side.
const API_PORT = Number(process.env.E2E_API_PORT ?? 8100);
const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 3100);
const python = process.env.E2E_PYTHON ?? 'python';
export const FROZEN_NOW = process.env.E2E_FROZEN_NOW ?? '2026-10-07T04:30:00.000Z';

export default defineConfig({
  testDir: './e2e',
  snapshotPathTemplate: '{testDir}/__golden__/{arg}{ext}',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    timezoneId: 'Asia/Kolkata',
    locale: 'en-IN',
    viewport: { width: 1280, height: 900 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  // Chromium runs every push (Golden E2E); Firefox and WebKit (Safari's
  // engine) run the same journeys in their own CI job (backlog #25). The
  // goldens are shared: the plan must read the same in every browser.
  projects: [
    {
      name: 'chromium',
      use: {
        browserName: 'chromium',
        launchOptions: process.env.PW_CHROMIUM_PATH
          ? { executablePath: process.env.PW_CHROMIUM_PATH, args: ['--no-sandbox'] }
          : {},
      },
    },
    { name: 'firefox', use: { browserName: 'firefox' } },
    { name: 'webkit', use: { browserName: 'webkit' } },
  ],
  webServer: [
    {
      command: `${python} ../e2e/api_server.py --port ${API_PORT}`,
      url: `http://127.0.0.1:${API_PORT}/api/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      stdout: 'pipe',
    },
    {
      command: `npx next start -p ${WEB_PORT}`,
      url: `http://localhost:${WEB_PORT}/login`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        API_BASE_URL: `http://127.0.0.1:${API_PORT}`,
        WEB_ORIGIN: `http://localhost:${WEB_PORT}`,
        NEXT_TELEMETRY_DISABLED: '1',
        E2E_FROZEN_NOW: FROZEN_NOW,
        NODE_OPTIONS: '--require ./e2e/freeze-time.cjs',
      },
    },
  ],
});
