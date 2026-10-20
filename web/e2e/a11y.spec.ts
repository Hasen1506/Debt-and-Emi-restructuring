/**
 * Accessibility and hydration on every page (backlog #24). axe-core
 * (WCAG 2 A and AA rules) runs on each page, signed out and signed in; a
 * serious or critical violation fails. So does a React hydration error or
 * any uncaught page error: the server and browser drawing different pages
 * is how the Windfall hydration bug went unnoticed.
 */
import type { Page } from '@playwright/test';
import { expect, fillLoan, signIn, test, makeSetupChoices, continueToPlan } from './fixtures';
import { isAbortedChunkError, isCutOffChunk, isWebKitNavigationNoise } from './browser-noise';

const AXE = require.resolve('axe-core/axe.min.js');

type Violation = { id: string; impact: string | null; help: string; nodes: { target: string[] }[] };

/** Watch a page for hydration and runtime errors from here on. */
function watchErrors(page: Page): { errors: string[]; beginNavigation: () => void; dropCutOffChunks: () => void } {
  const errors: string[] = [];
  const aborted = new Set<string>();
  let abortedThisNavigation = 0;
  page.on('requestfailed', (req) => {
    const why = req.failure()?.errorText ?? '';
    if (!/abort|cancel/i.test(why)) return;
    abortedThisNavigation += 1;
    if (req.url().includes('/_next/static/chunks/')) aborted.add(req.url());
  });
  page.on('pageerror', (e) => {
    // WebKit reports the page being left's requests, cut off by the next
    // navigation, as "…?_rsc=… due to access control checks" (link
    // prefetches) or "…/api/… due to access control checks" (a fetch the
    // page catches, such as Plan's rate-decision dates).
    // R10-3: the same rule the app's error reporter uses.
    if (isWebKitNavigationNoise(e.message)) return;
    errors.push(`pageerror: ${e.message}`);
  });
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (/hydrat|did not match|Minified React error #(418|423|425)/i.test(t)) errors.push(`hydration: ${t.slice(0, 300)}`);
  });
  return {
    errors,
    beginNavigation() { abortedThisNavigation = 0; },
    dropCutOffChunks() {
      const path = (() => { try { return new URL(page.url()).pathname; } catch { return '/'; } })();
      for (let i = errors.length - 1; i >= 0; i--) {
        const line = errors[i];
        // A bare "Load failed" is also what WebKit says for a request the
        // navigation aborted. Drop it only when this navigation did abort
        // a request; a Load failed on its own is still a failure.
        const bareLoadFailed = /^pageerror: (TypeError: )?Load failed$/i.test(line) && abortedThisNavigation > 0;
        if (bareLoadFailed || isAbortedChunkError(line, aborted) || isCutOffChunk(line, path)) errors.splice(i, 1);
      }
    },
  };
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

async function check(page: Page, path: string, watched: { errors: string[]; beginNavigation: () => void; dropCutOffChunks: () => void }) {
  watched.errors.length = 0;
  watched.beginNavigation();
  await page.goto(path, { waitUntil: 'load' });
  // Client data (profile, plan runs) settles after load; 'networkidle'
  // never came on pages that poll. The wait also lets an aborted chunk
  // request record its failure before the assertion drops it.
  await page.waitForTimeout(2500);
  const found = await axe(page);
  watched.dropCutOffChunks();
  expect.soft(found, `axe on ${path}`).toEqual([]);
  expect.soft(watched.errors, `errors on ${path}`).toEqual([]);
}

test('signed out: landing, sign-in and Loan Check pass axe with no hydration errors', async ({ page }) => {
  const watched = watchErrors(page);
  for (const path of ['/', '/login', '/tools/loan-check']) await check(page, path, watched);
});

test('signed in: every tab and tool passes axe with no hydration errors', async ({ page }) => {
  const watched = watchErrors(page);
  await signIn(page, 'a11y@rightdue.app');
  await page.getByLabel(/Take-home pay a month/).fill('150000');
  await page.getByLabel(/Spending a month/).fill('40000');
  await page.getByRole('button', { name: /CONTINUE · WHAT YOU OWE/ }).click();
  await fillLoan(page, 0, { kind: /^home$/i, balance: '3500000', rate: '8.5', emi: '35000' });
  await fillLoan(page, 1, { kind: /^card$/i, balance: '85000', rate: '42' });
  await page.getByRole('button', { name: /CONTINUE · SEE YOUR PLAN/ }).click();
  await makeSetupChoices(page);
  await page.getByRole('button', { name: /SAVE · OPEN MY PLAN/ }).click();
  await continueToPlan(page);
  for (const path of [
    '/',
    '/plan',
    '/activity',
    '/goals',
    '/profile',
    '/profile?step=loans',
    '/portfolio',
    '/tax',
    '/tools/windfall',
    '/tools/new-debt',
    '/tools/liquidate',
    '/tools/invest-vs-prepay',
    '/tools/loan-check',
  ]) {
    await check(page, path, watched);
  }
});

// Live re-test 7 R7-3: with no floating-rate loan the WHAT IF rate row is
// disabled, and its explanation used to be faded to 2.63:1 with it.
test('signed in, fixed-rate loans only: /plan with WHAT IF open passes axe', async ({ page }) => {
  const watched = watchErrors(page);
  await signIn(page, 'a11y-fixed@rightdue.app');
  await page.getByLabel(/Take-home pay a month/).fill('95000');
  await page.getByLabel(/Spending a month/).fill('41000');
  await page.getByRole('button', { name: /CONTINUE · WHAT YOU OWE/ }).click();
  await fillLoan(page, 0, { kind: /^card$/i, balance: '180000', rate: '39' });
  await fillLoan(page, 1, { kind: /^personal$/i, balance: '60000', rate: '13', emi: '5200' });
  await page.getByRole('button', { name: /CONTINUE · SEE YOUR PLAN/ }).click();
  await makeSetupChoices(page);
  await page.getByRole('button', { name: /SAVE · OPEN MY PLAN/ }).click();
  await continueToPlan(page);
  await page.waitForTimeout(2500);
  const whatIf = page.getByRole('button', { name: /WHAT IF/i }).first();
  if (await whatIf.isVisible().catch(() => false)) await whatIf.click();
  const reason = page.locator('#main').getByText('None of your loans has a floating rate, so a rate change doesn’t move the plan.');
  await reason.scrollIntoViewIfNeeded();
  await expect(reason).toBeVisible();
  // The reason line is drawn at full strength: nothing above it is faded.
  const faded = await reason.evaluate((el) => {
    for (let n: HTMLElement | null = el as HTMLElement; n; n = n.parentElement) if (Number(getComputedStyle(n).opacity) < 1) return true;
    return false;
  });
  expect(faded, 'the disabled row\'s explanation sits inside a faded wrapper').toBe(false);
  const found = await axe(page);
  expect(found, 'axe on /plan (fixed-rate loans, WHAT IF open)').toEqual([]);
  watched.dropCutOffChunks();
  expect.soft(watched.errors, 'errors on /plan').toEqual([]);
});
