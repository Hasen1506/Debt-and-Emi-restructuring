import { test as base, expect, type Page, type Response } from '@playwright/test';

/** The test's "now": 7 Oct 2026, 10:00 IST (same instant the server uses). */
export const FROZEN_NOW = new Date(process.env.E2E_FROZEN_NOW ?? '2026-10-07T04:30:00.000Z');
export const OTP = '424242';

export const test = base.extend<{ page: Page }>({
  page: async ({ page, context }, use) => {
    // No network: only the local web app and API may answer.
    await context.route(
      (url) => !/^(localhost|127\.0\.0\.1)$/.test(url.hostname),
      (route) => route.abort('blockedbyclient'),
    );
    await page.clock.setFixedTime(FROZEN_NOW);
    // page.goto, again when the app's own navigation cancelled it. Right
    // after a page loads, the app may still be re-rendering it: session
    // hydration calls router.refresh() when the account copy changed a
    // cookie (seen ~200 ms after /plan's load), and Home refreshes for the
    // activity cookie. In Firefox a goto sent while that RSC fetch is in
    // flight cancels the fetch, Next falls back to a browser navigation of
    // the current page, and that aborts the goto (CI run 38337335511:
    // NS_BINDING_ABORTED / NS_ERROR_FAILURE on four specs; reproduced with
    // router.refresh() + goto). Only that error is retried, after the
    // interrupting navigation has loaded; the goto must still reach its URL
    // and every assertion after it is unchanged.
    const goto = page.goto.bind(page);
    page.goto = async (url, options) => {
      for (let attempt = 1; ; attempt++) {
        try {
          return await goto(url, options);
        } catch (err) {
          if (attempt >= 3 || !NAVIGATION_ABORTED.test(String(err))) throw err;
          base.info().annotations.push({ type: 'goto retried', description: `${url}: ${String(err).split('\n')[0]}` });
          await page.waitForLoadState('load').catch(() => {});
        }
      }
    };
    await use(page);
  },
});

/** page.goto errors that mean "another navigation replaced this one". */
const NAVIGATION_ABORTED = /NS_BINDING_ABORTED|NS_ERROR_FAILURE|net::ERR_ABORTED|interrupted by another navigation|Navigation interrupted/;
export { expect };

/** The address a test signs in with. Firefox and WebKit run against one
 *  database in CI, so each browser gets its own user (name+webkit@…);
 *  otherwise WebKit signed in to the account Firefox had just set up. */
export function testEmail(email: string): string {
  const project = base.info().project.name;
  return project === 'chromium' ? email : email.replace('@', `+${project}@`);
}

export async function signIn(page: Page, address: string) {
  const email = testEmail(address);
  await page.goto('/login');
  await page.getByPlaceholder('you@example.com').fill(email);
  await page.getByRole('button', { name: /send code/i }).click();
  await expect(page.getByText(`We sent a 6-digit code to ${email}`)).toBeVisible();
  await page.getByPlaceholder('••••••').fill(OTP);
  await page.getByRole('button', { name: /verify and sign in/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
}

/** The loan blocks on the setup "What you owe" step, in order. */
export function loanBlocks(page: Page) {
  return page.locator('[role=group]').filter({ has: page.getByRole('group', { name: 'Kind of loan' }) });
}

export interface LoanInput {
  kind: RegExp;            // chip name, e.g. /^home$/i
  currency?: 'INR' | 'USD'; // set through "More terms" when not the home currency
  balance: string;
  rate: string;            // percent a year
  emi?: string;            // EMI loans only
}

export async function fillLoan(page: Page, index: number, loan: LoanInput) {
  if (index > 0) await page.getByRole('button', { name: /ADD ANOTHER LOAN/ }).click();
  const b = loanBlocks(page).nth(index);
  await b.getByRole('button', { name: loan.kind }).click();
  if (loan.currency) {
    await b.getByRole('button', { name: /MORE TERMS/ }).click();
    await b.getByLabel('Currency', { exact: true }).selectOption(loan.currency);
  }
  const card = loan.emi === undefined;
  await b.getByLabel(card ? 'Balance on the card' : 'Balance left to repay').fill(loan.balance);
  await b.getByLabel(card ? 'Card APR, % a year' : 'Interest rate, % a year').fill(loan.rate);
  if (!card) {
    await b.getByLabel('EMI a month').fill(loan.emi!);
    await b.getByRole('button', { name: /PAID ALREADY/ }).click();
  }
}

/** Setup's last step asks what only the person can decide (sprint G10,
 *  grill #22). The journeys keep their goldens: no emergency fund for now,
 *  and the cheapest path, which is what setup used to assume silently.
 *
 *  The plan preview above the choices is worked out again whenever the
 *  order changes, and the figures arriving push the choices down the page.
 *  A click sent while that happens can land on the preview instead (Firefox
 *  in CI, run 38329023142: "Not now" missed, so SAVE stayed on setup). So:
 *  wait for the preview to settle, and check each pick took. */
export async function makeSetupChoices(page: Page) {
  const notNow = page.getByRole('button', { name: /^Not now$/ });
  await expect(notNow).toBeVisible();
  await planPreviewSettled(page);
  await notNow.click();
  await expect(notNow).toHaveAttribute('aria-pressed', 'true');
  const order = page.getByRole('button', { name: /^Cheapest path \(Avalanche\)/ });
  if ((await order.count()) && (await order.getAttribute('aria-pressed')) !== 'true') {
    const rerun = page.waitForResponse(isPlanCall('/api/simulate'));
    await order.click();
    await rerun;
    await expect(order).toHaveAttribute('aria-pressed', 'true');
  }
  await planPreviewSettled(page);
}

/** Profile: open one part of the form with its [EDIT] and check it opened.
 *  /profile draws its summary again once the account copy arrives (session
 *  hydration remounts the editor), and the rows can move while it does. A
 *  click sent in that moment is lost: WebKit in CI, run 38333832010, stayed
 *  on the summary for the whole two minutes. So click until the part's own
 *  heading shows; what the test asserts afterwards is unchanged. */
export async function openProfileSection(page: Page, section: string) {
  const edit = page.getByRole('button', { name: `Edit ${section}`, exact: true });
  const opened = page.getByRole('heading', { level: 1, name: section, exact: true });
  await expect(edit.or(opened).first()).toBeVisible();
  await expect(async () => {
    if (!(await opened.isVisible()) && (await edit.isVisible())) await edit.click({ timeout: 2_000 });
    await expect(opened).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
}

/** Setup's plan preview has finished loading (figures or an error shown). */
export async function planPreviewSettled(page: Page) {
  await expect(page.getByText('Working out your plan…')).toHaveCount(0);
}

/** After signIn: true when the account has no profile yet. The server
 *  redirects such an account to /onboarding before the page loads, so the
 *  landed URL says it; no timed probe needed. */
export async function landedOnOnboarding(page: Page): Promise<boolean> {
  await page.waitForLoadState('load');
  return new URL(page.url()).pathname === '/onboarding';
}

/** A compact, stable summary of a /api/simulate or /api/baseline response. */
export async function planSummary(res: Response) {
  const body = await res.json();
  const traj = body.trajectory as { month: number; balance: string; interest_paid: string; total_paid: string }[];
  return {
    debt_free_month: body.debt_free_month,
    total_interest_paid: Number(body.total_interest_paid).toFixed(2),
    months_in_horizon: body.months_in_horizon,
    yearly: traj
      .filter((p) => p.month === 1 || p.month % 12 === 0 || p.month === traj.length)
      .map((p) => ({ month: p.month, balance: p.balance, interest: p.interest_paid, paid: p.total_paid })),
  };
}

export function isPlanCall(path: '/api/simulate' | '/api/baseline') {
  return (r: Response) => r.request().method() === 'POST' && new URL(r.url()).pathname === path && r.ok();
}

/** Headline figures and the month-by-month table on /plan, as plain text. */
export async function planText(page: Page) {
  await expect(page.getByRole('heading', { name: /^MONTH BY MONTH/ })).toBeVisible();
  const table = page.locator('table').filter({ hasText: 'EVENT' }).first();
  const rows = await table.locator('tr').allInnerTexts();
  return rows.map((r) => r.replace(/\s+/g, ' ').trim()).join('\n') + '\n';
}

export function money(text: string): number {
  return Number(text.replace(/[^0-9.\-]/g, ''));
}
