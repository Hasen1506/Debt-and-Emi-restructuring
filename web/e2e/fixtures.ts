import { test as base, expect, type BrowserContext, type Page, type Response } from '@playwright/test';

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
    // Founder 18 Oct 2026: a saved plan pays EMIs and minimums only until the
    // user chooses a monthly total for debts. The journeys and goldens were
    // recorded with all spare cash; they choose it up front. The prompt's own
    // spec clears this cookie.
    await chooseAllSpareCash(context);
    // page.goto and page.reload go through settleNavigation (below): a
    // goto the app's own refresh aborted is sent again, and a navigation
    // Playwright stranded in Firefox is released.
    const goto = page.goto.bind(page);
    const reload = page.reload.bind(page);
    page.goto = (url, options) => settleNavigation(page, url, options, (o) => goto(url, o));
    page.reload = (options) => settleNavigation(page, null, options, (o) => reload(o));
    await use(page);
  },
});

/** The debt-budget choice the journeys make up front: all spare cash. Set
 *  on this browser only (the cookie a choice writes); a journey that opens a
 *  second browser makes the same choice there. */
export async function chooseAllSpareCash(context: BrowserContext) {
  await context.addCookies([{ name: 'rightdue_debt_budget', value: 'all', domain: 'localhost', path: '/' }]);
}

/** page.goto errors that mean "another navigation replaced this one". */
const NAVIGATION_ABORTED = /NS_BINDING_ABORTED|NS_ERROR_FAILURE|net::ERR_ABORTED|interrupted by another navigation|Navigation interrupted/;

/** How long one navigation attempt may take. Every page here loads in a
 *  few seconds; a 120 s test timeout is not a navigation budget. */
const ATTEMPT_MS = 30_000;
/** How long to wait for the navigation that aborted ours to load. */
const REPLACED_NAV_MS = 10_000;

type NavOptions = { timeout?: number; waitUntil?: 'load' | 'domcontentloaded' | 'networkidle' | 'commit'; referer?: string };

/**
 * One page.goto / page.reload, settled. Two failures that are the browser
 * driver's or the app's re-render, not the page under test, are retried
 * (at most 3 attempts, each recorded as a test annotation); anything else
 * is thrown as it was, and the caller's assertions are unchanged.
 *
 * 1. Aborted by another navigation. Right after a page loads, the app may
 *    still be re-rendering it: session hydration calls router.refresh()
 *    when the account copy changed a cookie (~200 ms after /plan's load),
 *    and Home refreshes for the activity cookie. In Firefox a goto sent
 *    while that RSC fetch is in flight cancels the fetch, Next falls back
 *    to a browser navigation of the current page, and that aborts the goto
 *    (CI run 38337335511; reproduced with router.refresh() + goto). Sent
 *    again once the interrupting navigation has loaded (bounded wait).
 * 2. Stranded. In Firefox, Playwright sometimes never settles a goto whose
 *    page did load: new document, readyState "complete", nothing in flight
 *    (microsoft/playwright#42183, ~1 in 100-200 navigations on CI). CI run
 *    38343729134: product-surface:11 goto('/') - the landing fully drawn
 *    (US example, toggle pressed), its two requests done (document 200,
 *    fonts.googleapis aborted by our route) - waited for "load" until the
 *    120 s test timeout. A superseding navigation releases it. So an
 *    attempt gets ATTEMPT_MS; on its timeout, if the page is complete at
 *    the URL asked for, the navigation is issued again. A page that really
 *    did not load still fails, with the original timeout error.
 */
export async function settleNavigation(
  page: Page,
  url: string | null,
  options: NavOptions | undefined,
  navigate: (options: NavOptions) => Promise<Response | null>,
): Promise<Response | null> {
  const attemptOptions = { ...options, timeout: options?.timeout ?? ATTEMPT_MS };
  const what = url ?? 'reload';
  for (let attempt = 1; ; attempt++) {
    const urlBefore = page.url();
    try {
      return await navigate(attemptOptions);
    } catch (err) {
      const message = String(err);
      if (attempt >= 3) throw err;
      if (NAVIGATION_ABORTED.test(message)) {
        base.info().annotations.push({ type: 'goto retried', description: `${what}: ${message.split('\n')[0]}` });
        // Wait for the navigation that replaced ours to load. Checking the
        // load state alone returned at once (the old document's "load" had
        // fired), so all three attempts were spent within 100 ms while the
        // app's fallback navigation was still in flight (local Firefox run,
        // reload after a Profile save: three NS_BINDING_ABORTED in 90 ms).
        await page.waitForEvent('load', { timeout: REPLACED_NAV_MS }).catch(() => {});
        await page.waitForLoadState('load', { timeout: ATTEMPT_MS }).catch(() => {});
        continue;
      }
      if (/Timeout \d+ms exceeded/.test(message) && (await loadedAt(page, url ?? urlBefore))) {
        base.info().annotations.push({ type: 'goto stranded', description: `${what}: page loaded but ${message.split('\n')[0]} (playwright#42183); navigating again` });
        continue;
      }
      throw err;
    }
  }
}

/** True when the page has finished loading a document at `target`. */
async function loadedAt(page: Page, target: string): Promise<boolean> {
  const want = new URL(target, base.info().project.use.baseURL ?? page.url());
  const state = await Promise.race([
    page.evaluate(() => ({ ready: document.readyState, href: location.href })).catch(() => null),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 5_000)),
  ]);
  if (!state || state.ready !== 'complete') return false;
  const have = new URL(state.href);
  return have.origin === want.origin && have.pathname === want.pathname && have.search === want.search;
}
export { expect };

/** The address a test signs in with. Firefox and WebKit run against one
 *  database in CI, so each browser gets its own user (name+webkit@…);
 *  otherwise WebKit signed in to the account Firefox had just set up. */
export function testEmail(email: string): string {
  const project = base.info().project.name;
  return project === 'chromium' ? email : email.replace('@', `+${project}@`);
}

/** audit80 D7 (W8): "Agree and send code" stays disabled until the 18+ box
 *  is ticked; every sign-in in the suite goes through here. */
export async function confirmAgeAndSend(page: Page) {
  const box = page.getByTestId('age-confirm');
  const send = page.getByRole('button', { name: /send code/i });
  // A tick that lands while the page hydrates can show ticked with the
  // button still disabled (the page now reads it on mount); toggle again
  // until the button agrees, then send.
  await expect(async () => {
    if (await box.isChecked()) await box.uncheck({ timeout: 2_000 });
    await box.check({ timeout: 2_000 });
    await expect(send).toBeEnabled({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
  await send.click();
}

export async function signIn(page: Page, address: string) {
  const email = testEmail(address);
  await page.goto('/login');
  await page.getByPlaceholder('you@example.com').fill(email);
  await confirmAgeAndSend(page);
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
  /** "Has this month's EMI gone out?" (EMI loans). Default 'paid'. */
  emiGoneOut?: 'paid' | 'due';
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
    // R7-7: US Setup says "Monthly payment" where India says "EMI a month".
    await b.getByRole('textbox', { name: /EMI a month|Monthly payment/ }).fill(loan.emi!);
    await b.getByRole('button', { name: loan.emiGoneOut === 'due' ? /^NOT YET$/ : /PAID ALREADY/ }).click();
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
  // Audit 80+ A2 (W3): when the order doesn't change the plan, the order
  // question is replaced by one line (data-testid order-same) once the
  // preview's order check arrives, so the chips can vanish between a count()
  // and a click. Retry until either the line shows or Cheapest is pressed.
  // NEW-19: the preview re-runs after a short pause, or answers from memory
  // when the same plan was just worked out, so wait for the preview itself.
  await expect(async () => {
    await planPreviewSettled(page);
    if (await page.getByTestId('order-same').isVisible()) return;
    if ((await order.getAttribute('aria-pressed', { timeout: 2_000 })) !== 'true') await order.click({ timeout: 2_000 });
    await expect(order).toHaveAttribute('aria-pressed', 'true', { timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
  await planPreviewSettled(page);
}

/** SAVE · OPEN MY PLAN lands on Home. The journeys still open the plan,
 *  through the first-session nudge. */
export async function continueToPlan(page: Page) {
  await page.waitForURL((u) => u.pathname === '/');
  // Home also links "WHY THIS ORDER? SEE THE PLAN". The nudge is the one
  // the first session is for.
  const plan = page.getByTestId('first-session').getByRole('link', { name: /SEE THE PLAN/ });
  await expect(plan).toBeVisible();
  await plan.click();
  await page.waitForURL('**/plan');
}

/** Profile: open one part of the form with its [EDIT] and check it opened.
 *  /profile draws its summary again once the account copy arrives (session
 *  hydration remounts the editor), and the rows can move while it does. A
 *  click sent in that moment is lost: WebKit in CI, run 38333832010, stayed
 *  on the summary for the whole two minutes. So click until the part's own
 *  heading shows; what the test asserts afterwards is unchanged. */
export async function openProfileSection(page: Page, section: string) {
  const edit = page.getByRole('button', { name: `Edit ${section}`, exact: true })
    .or(page.getByRole('link', { name: `Edit ${section}`, exact: true }));
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

/** Setup's preview of the plan itself. Since audit 80+ B4/A22 (W6) Setup
 *  also runs the same loans smallest-first ("what you'd likely do") in
 *  parallel; whichever answered first used to become the golden, so the
 *  snapshot flipped between runs. The plan call is the one that isn't that
 *  snowball baseline (the journeys keep the cheapest path). */
export function isSetupPlanCall() {
  const plan = isPlanCall('/api/simulate');
  return (r: Response) => {
    if (!plan(r)) return false;
    try {
      return (r.request().postDataJSON() as { strategy?: string } | null)?.strategy !== 'snowball';
    } catch {
      return true;
    }
  };
}

/** Headline figures and the month-by-month table on /plan, as plain text. */
export async function planText(page: Page) {
  await expect(page.getByRole('heading', { name: /^MONTH BY MONTH/ })).toBeVisible();
  const table = page.locator('#main table').filter({ hasText: 'EVENT' }).first();
  const rows = await table.locator('tr').allInnerTexts();
  return rows.map((r) => r.replace(/\s+/g, ' ').trim()).join('\n') + '\n';
}

export function money(text: string): number {
  return Number(text.replace(/[^0-9.\-]/g, ''));
}
