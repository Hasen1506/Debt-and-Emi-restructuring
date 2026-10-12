/**
 * Accessibility and hydration on every page (backlog #24). axe-core
 * (WCAG 2 A and AA rules) runs on each page, signed out and signed in; a
 * serious or critical violation fails. So does a React hydration error or
 * any uncaught page error: the server and browser drawing different pages
 * is how the Windfall hydration bug went unnoticed.
 */
import type { Page } from '@playwright/test';
import { expect, fillLoan, signIn, test, makeSetupChoices } from './fixtures';

const AXE = require.resolve('axe-core/axe.min.js');

type Violation = { id: string; impact: string | null; help: string; nodes: { target: string[] }[] };

/** Watch a page for hydration and runtime errors from here on. */
function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => {
    // WebKit reports the page being left's requests, cut off by the next
    // navigation, as "…?_rsc=… due to access control checks" (link
    // prefetches) or "…/api/… due to access control checks" (a fetch the
    // page catches, such as Plan's rate-decision dates).
    if (/(_rsc=|\/api\/).*access control checks/.test(e.message)) return;
    errors.push(`pageerror: ${e.message}`);
  });
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (/hydrat|did not match|Minified React error #(418|423|425)/i.test(t)) errors.push(`hydration: ${t.slice(0, 300)}`);
  });
  return errors;
}

async function axe(page: Page): Promise<string[]> {
  await page.addScriptTag({ path: AXE });
  const violations = (await page.evaluate(async () => {
    const r = await (window as unknown as { axe: { run: (c: unknown, o: unknown) => Promise<{ violations: unknown[] }> } }).axe.run(document, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
    });
    return r.violations;
  })) as Violation[];
  return violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id} (${v.impact}): ${v.help} · ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`);
}

async function check(page: Page, path: string, errors: string[]) {
  errors.length = 0;
  await page.goto(path, { waitUntil: 'load' });
  // Client data (profile, plan runs) settles after load; 'networkidle'
  // never came on pages that poll.
  await page.waitForTimeout(2500);
  const found = await axe(page);
  expect.soft(found, `axe on ${path}`).toEqual([]);
  expect.soft(errors, `errors on ${path}`).toEqual([]);
}

test('signed out: landing, sign-in and Loan Check pass axe with no hydration errors', async ({ page }) => {
  const errors = watchErrors(page);
  for (const path of ['/', '/login', '/tools/loan-check']) await check(page, path, errors);
});

test('signed in: every tab and tool passes axe with no hydration errors', async ({ page }) => {
  const errors = watchErrors(page);
  await signIn(page, 'a11y@rightdue.app');
  await page.getByLabel(/Take-home pay a month/).fill('150000');
  await page.getByLabel(/Spending a month/).fill('40000');
  await page.getByRole('button', { name: /CONTINUE · WHAT YOU OWE/ }).click();
  await fillLoan(page, 0, { kind: /^home$/i, balance: '3500000', rate: '8.5', emi: '35000' });
  await fillLoan(page, 1, { kind: /^card$/i, balance: '85000', rate: '42' });
  await page.getByRole('button', { name: /CONTINUE · SEE YOUR PLAN/ }).click();
  await makeSetupChoices(page);
  await page.getByRole('button', { name: /SAVE · OPEN MY PLAN/ }).click();
  await page.waitForURL('**/plan');
  for (const path of [
    '/',
    '/plan',
    '/activity',
    '/goals',
    '/profile',
    '/profile?step=loans',
    '/portfolio',
    '/tools/windfall',
    '/tools/new-debt',
    '/tools/liquidate',
    '/tools/invest-vs-prepay',
    '/tools/loan-check',
  ]) {
    await check(page, path, errors);
  }
});
