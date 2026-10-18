/**
 * Audit 80, W5 (A12, A13, A14/E8) at 390 px, a phone:
 *
 * - A12: the prompt link says what it does ("Hide until next month"), never
 *   "Remind me next month" (nothing was ever sent), and tapping it hides the
 *   prompt on this device.
 * - A12: the payday email opt-in (day picker + TURN ON) fits the screen and
 *   turns on.
 * - A13: the rate-move email opt-in lists the floating home loan and turns on.
 * - A14/E8: the payday email's link (?ritual=payday) opens the 60-second
 *   payday check on Home.
 *
 * The golden E2E API runs with the email flags off (as production does
 * today), so the browser's /api/notify calls are answered here: this checks
 * the UI, not the sender (api/tests/test_a80_w05_notify.py covers that).
 */
import type { Page } from '@playwright/test';
import { expect, fillLoan, loanBlocks, makeSetupChoices, signIn, test } from './fixtures';

/**
 * Answer the browser's /api/notify calls inside the page: window.fetch is
 * wrapped for /api/notify/* before any app script runs. Not page.route():
 * WebKit (Linux) never hands requests to the API's other origin
 * (127.0.0.1:8141) to Playwright's router, so they reached the real API with
 * the flags off and the opt-ins rightly stayed hidden (integration-4).
 * Returns a reader for the PUTs the page sent.
 */
async function stubNotify(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __notifyPuts?: { path: string; body: unknown }[] };
    w.__notifyPuts = [];
    const real = window.fetch.bind(window);
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const m = /\/api\/notify(\/[^?]*)/.exec(url);
      if (!m) return real(input, init);
      const path = m[1];
      const method = (init?.method ?? 'GET').toUpperCase();
      const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
      if (path === '/flags') return json({ payday_email: true, deadline_reminders: true, reply_done: false, rate_move: true });
      if (path === '/settings') {
        return json({ payday: { on: false, day: null, list_month: null }, reminders: { on: false, count: 0 },
          rate_move: { available: true, on: false, count: 0 }, email: 'x@rightdue.app' });
      }
      if (path === '/answers') return json({ answers: [] });
      if (method === 'PUT') {
        w.__notifyPuts!.push({ path, body: typeof init?.body === 'string' ? JSON.parse(init.body) : null });
        return json(path === '/rate-move' ? { ok: true, on: true, count: 1 } : { ok: true, next: null });
      }
      return real(input, init);
    };
  });
  return async () => page.evaluate(() => (window as unknown as { __notifyPuts?: { path: string; body: unknown }[] }).__notifyPuts ?? []);
}

/** No horizontal scroll, and the element sits inside the viewport. */
async function expectOnScreen(page: Page, testId: string) {
  const el = page.getByTestId(testId);
  await expect(el).toBeVisible();
  const box = (await el.boundingBox())!;
  const { docW, vw } = await page.evaluate(() => ({ docW: document.documentElement.scrollWidth, vw: window.innerWidth }));
  expect(docW, `${testId}: the page scrolls sideways`).toBeLessThanOrEqual(vw);
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width, `${testId} runs past the right edge`).toBeLessThanOrEqual(vw + 0.5);
}

test.describe('A80 W5 retention at 390px', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('opt-ins fit and turn on; "Hide until next month" hides the prompt; the payday link opens the check', async ({ page, browserName }) => {
    const readPuts = await stubNotify(page);
    await signIn(page, `golden-a80-w05-${browserName}@rightdue.app`);
    await expect(page).toHaveURL(/\/onboarding$/);
    await page.getByLabel(/Take-home pay a month/).fill('150000');
    await page.getByLabel(/Spending a month/).fill('50000');
    await page.getByRole('button', { name: /CONTINUE · WHAT YOU OWE/ }).click();
    await expect(page).toHaveURL(/step=loans/);
    await fillLoan(page, 0, { kind: /^home$/i, balance: '5000000', rate: '8.5', emi: '43391' });
    // A13 watches floating-rate loans only: say so explicitly.
    const b = loanBlocks(page).nth(0);
    await b.getByRole('button', { name: /MORE TERMS/ }).click();
    await b.getByLabel('Fixed or floating rate').selectOption('floating');
    await page.getByRole('button', { name: /CONTINUE · SEE YOUR PLAN/ }).click();
    await expect(page).toHaveURL(/step=plan/);
    await makeSetupChoices(page);
    await page.getByRole('button', { name: /SAVE · OPEN MY PLAN/ }).click();
    await page.waitForURL('**/plan');

    await page.goto('/');
    // A12: the honest label, and the old promise is gone.
    const hide = page.getByRole('button', { name: 'Hide until next month' }).first();
    await expect(hide).toBeVisible();
    await expect(page.getByText(/Remind me next month/i)).toHaveCount(0);

    // A12: payday email opt-in.
    await expectOnScreen(page, 'payday-email');
    const payday = page.getByTestId('payday-email');
    await payday.getByLabel('Day your salary is paid').selectOption('1');
    await payday.getByRole('button', { name: 'TURN ON' }).click();
    await expect(payday.getByRole('status')).toContainText('On.');
    expect((await readPuts()).find((p) => p.path === '/payday')?.body).toMatchObject({ on: true, day: 1 });

    // A13: rate-move opt-in lists the floating home loan.
    await expectOnScreen(page, 'rate-move-email');
    const rate = page.getByTestId('rate-move-email');
    await expect(rate.getByRole('checkbox').first()).toBeChecked();
    await rate.getByRole('button', { name: 'TURN ON' }).click();
    await expect(rate.getByRole('status')).toContainText('On.');
    const sent = (await readPuts()).find((p) => p.path === '/rate-move')?.body as { on: boolean; loans: { rate: number }[] };
    expect(sent.on).toBe(true);
    expect(sent.loans).toHaveLength(1);

    // A12: hiding a prompt removes it (on this device only).
    const before = await page.getByRole('button', { name: 'Hide until next month' }).count();
    await hide.click();
    await expect(page.getByRole('button', { name: 'Hide until next month' })).toHaveCount(before - 1);

    // A14/E8: the payday email's link opens the 60-second check.
    await page.goto('/?ritual=payday&m=2026-10#home-pay');
    await expectOnScreen(page, 'payday-ritual');
    await expect(page.getByTestId('payday-ritual')).toContainText('Your 60-second payday check');
  });
});
