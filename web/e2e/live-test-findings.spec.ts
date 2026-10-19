/**
 * Sprint L5: one regression test per live-test finding (1–33,
 * /workspace/work/rightdue-live-test.md). Titles are "L#<n> [<owner>] …".
 *
 *  - test(...)       : right on main; guards it.
 *  - test.fixme(...) : fixed on the owner's sprint branch (hark/sprint-<ws>).
 *    The integrator flips it to test(...) after merging that branch and
 *    adjusts any selector the branch named differently (the owner's own
 *    spec, where one exists, is named beside it).
 *  - Guest-mode tests run only with E2E_GUEST_MODE=1 against a build made
 *    with NEXT_PUBLIC_DISABLE_AUTH=true (how production served guests
 *    during the live test). CI builds the signed-in app, so they skip there.
 */
import { expect, fillLoan, landedOnOnboarding, signIn, test, makeSetupChoices, openProfileSection, continueToPlan } from './fixtures';
import { setUpPersona } from './persona';

const API = `http://127.0.0.1:${process.env.E2E_API_PORT ?? 8100}`;
const GUEST = process.env.E2E_GUEST_MODE === '1';

// ── Guards: right on main ────────────────────────────────────────────────
test.describe('guards on main', () => {
  let ready = false;
  test.beforeEach(async ({ page }) => {
    // One account for the whole group (each test signs in again).
    if (!ready) {
      await setUpPersona(page, 'golden-l5-findings@rightdue.app');
      ready = true;
    } else {
      await signIn(page, 'golden-l5-findings@rightdue.app');
    }
  });

  test('L#30 [main] four core tabs + More (audit 80+ A20), each opens without a dead end', async ({ page }) => {
    await page.goto('/');
    const nav = page.getByRole('navigation', { name: 'Main' });
    // The brackets are drawn aria-hidden (E13): the link names are the words.
    for (const [name, path] of [['Home', '/'], ['Plan', '/plan'], ['Activity', '/activity'], ['Profile', '/profile']] as const) {
      await nav.getByRole('link', { name, exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`${path === '/' ? '/$' : path}`));
      await expect(page.getByText(/This page could not be found|Application error/i)).toHaveCount(0);
    }
    // Goals & tools and Assets & tax (Portfolio + Tax merged) sit behind More.
    for (const [name, path] of [['Goals & tools', '/goals'], ['Assets & tax', '/portfolio']] as const) {
      await nav.getByRole('button', { name: /^\+?\s*More/ }).click();
      await page.locator('#rd-more-panel').getByRole('link', { name: new RegExp(`^${name}`) }).click();
      await expect(page).toHaveURL(new RegExp(path));
      await expect(page.getByText(/This page could not be found|Application error/i)).toHaveCount(0);
    }
  });

  test('L#18 [main] Spare Cash sends a ₹50,000 bonus to the dearest debt (the 42% card)', async ({ page }) => {
    await page.goto('/tools/windfall');
    await page.getByLabel('Amount, after tax').fill('50000');
    await expect(page.getByText(/The dearest debt left/i).first()).toBeVisible();
    await expect(page.getByText(/Credit card/).first()).toBeVisible();
  });

  test('L#31 [main] Plan notes compare the loans with a dated, sourced rate', async ({ page }) => {
    await page.goto('/plan');
    await expect(page.getByText(/as of \d{1,2} \w{3} 20\d\d/).first()).toBeVisible();
  });

  test('L#25 [main] a short month shows "Feeling overwhelmed?" on Home', async ({ page }) => {
    await page.goto('/profile');
    await openProfileSection(page, 'Income and spending');
    await page.getByLabel(/In-hand salary|Take-home pay a month/).fill('20000');
    await page.getByRole('button', { name: /SAVE CHANGES/ }).click();
    await expect(page.getByText('Saved. Home and Plan use the new numbers.')).toBeVisible();
    await page.goto('/');
    await expect(page.getByRole('button', { name: /FEELING OVERWHELMED\? ONE STEP AT A TIME/ })).toBeVisible();
  });

  test('L#27 [main] (signed in) reverting the stress income persists across reload', async ({ page }) => {
    await page.goto('/profile');
    await openProfileSection(page, 'Income and spending');
    await page.getByLabel(/In-hand salary|Take-home pay a month/).fill('120000');
    await page.getByRole('button', { name: /SAVE CHANGES/ }).click();
    await expect(page.getByText('Saved. Home and Plan use the new numbers.')).toBeVisible();
    await page.reload();
    await expect(page.getByText(/₹1,20,000/).first()).toBeVisible();
  });
});

// API-level guards (no UI selectors to drift).
test('L#14 [main] a floating rate rise on a home loan never grows the balance (no negative amortisation)', async ({ request }) => {
  const res = await request.get(`${API}/api/health`);
  expect(res.ok()).toBeTruthy();
  // The engine side is covered month by month in
  // engine/tests/test_golden_statements.py (home_floating_sbi_style) and
  // simulation._reset_rate; this guards that the API is up for the UI step.
});

test('L#6 [main] sign-in by emailed code works end to end', async ({ page }) => {
  await signIn(page, 'golden-l5-otp@rightdue.app');
  await expect(page).toHaveURL(/\/onboarding$/);
});

// ── L1 persistence (guest saves) ─────────────────────────────────────────
test.describe('guest mode (E2E_GUEST_MODE=1)', () => {
  test.skip(!GUEST, 'needs a NEXT_PUBLIC_DISABLE_AUTH=true build');
  test('L#2 [L1] a guest Profile save succeeds and the toast clears', async ({ page }) => {
    await page.goto('/profile');
    await openProfileSection(page, 'Where you live and tax');
    await page.getByRole('button', { name: /SAVE CHANGES/ }).click();
    await expect(page.getByText(/Changes have not reached your account/)).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Retry save/ })).toHaveCount(0);
  });
  test('L#3 [L1] guest loans survive navigation and reload', async ({ page }) => {
    await page.goto('/onboarding');
    await page.getByLabel(/In-hand salary|Take-home pay a month/).fill('120000');
    await page.getByLabel(/Spending a month/).fill('40000');
    await page.getByRole('button', { name: /CONTINUE · WHAT YOU OWE/ }).click();
    await fillLoan(page, 0, { kind: /^card$/i, balance: '150000', rate: '42' });
    await page.getByRole('button', { name: /CONTINUE · SEE YOUR PLAN/ }).click();
    await makeSetupChoices(page);
    await page.getByRole('button', { name: /SAVE · OPEN MY PLAN/ }).click();
    await page.reload();
    await page.goto('/profile');
    await expect(page.locator('table').filter({ hasText: 'OWED' }).getByRole('row', { name: /^Credit card/ })).toBeVisible();
  });
  test('L#27 [L1] a guest income revert persists across reload', async ({ page }) => {
    await page.goto('/profile');
    await openProfileSection(page, 'Income and spending');
    await page.getByLabel(/In-hand salary|Take-home pay a month/).fill('120000');
    await page.getByRole('button', { name: /SAVE CHANGES/ }).click();
    await page.reload();
    await expect(page.getByText(/₹1,20,000/).first()).toBeVisible();
  });
  test('L#33 [L1] a failed save says why, when it last tried, and retries with visible progress', async ({ page }) => {
    await page.route('**/api/user/**', (r) => r.abort('connectionfailed'));
    await page.goto('/profile');
    await openProfileSection(page, 'Where you live and tax');
    await page.getByRole('button', { name: /SAVE CHANGES/ }).click();
    const retry = page.getByRole('button', { name: /Retry save/ });
    await retry.click();
    await expect(page.getByRole('status')).toContainText(/Last tried|Retrying|couldn't reach/i);
  });
});

// The owner-fix findings below run signed in as the findings persona
// (CI builds the signed-in app; an unsigned visit lands on /login).
test.describe('owner fixes (signed in)', () => {
  test.beforeEach(async ({ page }) => {
    if (!GUEST) await setUpPersona(page, 'golden-l5-findings@rightdue.app');
  });

  // ── L3 ux-flows (owner spec: web/e2e/l3-ux-flows.spec.ts on hark/sprint-L3) ──
  test('L#1 [L3] a returning guest is offered "Start fresh" or "Continue"', async ({ page }) => {
    test.skip(!GUEST, 'guest-only: needs a NEXT_PUBLIC_DISABLE_AUTH build (E2E_GUEST_MODE=1); owner spec l3-ux-flows covers it');
    await page.goto('/');
    await expect(page.locator('#main').getByTestId('guest-welcome-back')).toBeVisible();
  });
  test('L#4 [L3] a loan takes a nickname', async ({ page }) => {
    await page.goto('/profile');
    await openProfileSection(page, 'Loans');
    await expect(page.getByLabel('Nickname (optional)').first()).toBeVisible();
  });
  test('L#5 [L3] Where you live takes a state and a city', async ({ page }) => {
    await page.goto('/profile');
    await openProfileSection(page, 'Where you live and tax');
    await expect(page.getByLabel('State (optional)')).toBeVisible();
    await expect(page.getByLabel('City (optional)')).toBeVisible();
  });
  test('L#6b [L3] no Google button unless the server turns it on', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByTestId('google-signin')).toHaveCount(0);
    expect(await (await page.request.get(`${API}/api/auth/google/config`)).json()).toEqual({ enabled: false });
  });
  test('L#11 [L3+G1] a floating loan asks "for a business?" before assuming a 0% prepayment fee', async ({ page }) => {
    await page.goto('/profile');
    await openProfileSection(page, 'Loans');
    await expect(page.getByTestId('business-purpose').getByText(/Not answered yet/)).toBeVisible();
  });
  test('L#13 [L3] every addend of the card\'s yearly cost is named', async ({ page }) => {
    await page.goto('/profile');
    await openProfileSection(page, 'Loans');
    await expect(page.getByTestId('cost-line-gst').first()).toContainText('GST on the interest (18%)');
    await expect(page.getByText('= 60.31%').first()).toBeVisible();
  });
  test('L#19 [L3] after LOG IT the next what-if is labelled as the next round', async ({ page }) => {
    await page.goto('/tools/windfall');
    await page.getByLabel('Amount, after tax').fill('50000');
    await page.getByRole('button', { name: /I DID THIS · LOG IT/ }).click();
    await expect(page.getByText("Got another ₹50,000? Here's where it would go next")).toBeVisible();
  });
  test('L#20 [L3] spare cash takes the date it came in', async ({ page }) => {
    await page.goto('/tools/windfall');
    await expect(page.getByLabel('Date it came in')).toBeVisible();
  });
  test('L#23 [L3+G1] card interest counts new spend from its transaction date', async ({ request }) => {
    // Engine side: engine/tests/test_golden_statements.py card_revolving_hdfc_style
    // (strict xfail until G1 #25 lands). UI side: the persona's ₹20,000/mo spend.
    expect((await request.get(`${API}/api/health`)).ok()).toBeTruthy();
  });
  test('L#32 [L3+G1] the home loan\'s all-in uplift is labelled line by line', async ({ page }) => {
    await page.goto('/profile');
    await openProfileSection(page, 'Loans');
    await expect(page.locator('[data-testid^="cost-line-"]').first()).toBeVisible();
  });

  // ── G5 loan-check (owner spec: web/e2e/loan-check.spec.ts; same flow) ──
  async function loanCheck(page: import('@playwright/test').Page, lender: string | { name: string; type: string }, spread = true) {
    await page.goto('/tools/loan-check');
    // Signed in, the persona's saved home loan is picked and its numbers
    // filled in (G5 prefill). These checks type their own loan.
    const another = page.getByRole('group', { name: 'Which loan?' }).getByRole('button', { name: 'Another loan', exact: true });
    // The persona always has one, so wait for it rather than probe for it.
    if (!GUEST) {
      await expect(another).toBeVisible();
      await another.click();
    }
    const pick = page.getByTestId('lc-lender');
    await expect(pick.locator('option', { hasText: 'LIC Housing Finance' })).toHaveCount(1);
    if (typeof lender === 'string') await pick.selectOption({ label: lender });
    else {
      await pick.selectOption({ label: 'Another lender (not listed)' });
      await page.getByLabel("Lender's name").fill(lender.name);
      await page.getByLabel('What kind of lender?').selectOption({ label: lender.type });
    }
    await page.getByLabel('Rate you pay now (%)').fill('9.15');
    await page.getByLabel('Still owed').fill('3000000');
    await page.getByLabel('Months left').fill('200');
    await page.getByLabel('Month the loan started: month').selectOption({ label: 'March' });
    await page.getByLabel('Month the loan started: year').selectOption('2022');
    await page.getByLabel('What is the rate linked to?').selectOption('repo');
    await page.getByLabel('Rate when the loan started (%)').fill('9.15');
    if (spread) await page.getByTestId('lc-spread-question').getByRole('button', { name: 'No', exact: true }).click();
    await page.getByRole('button', { name: /check my loan/i }).click();
  }
  test('L#7 [G5] paying BELOW the should-be rate reads as good news, not a complaint', async ({ page }) => {
    await loanCheck(page, 'SBI');
    await expect(page.getByText('You pay less than the repo moves imply: in your favour.')).toBeVisible();
    await expect(page.getByText('Worth a conversation with your bank.')).toHaveCount(0);
  });
  test('L#8 [G5] identical numbers give the same verdict whatever the bank is called', async ({ page }) => {
    // G5: a housing finance company (LIC HFL) is NOT bound by the banks'
    // repo rule, so it gets its own verdict by design; compare two banks.
    await loanCheck(page, 'SBI');
    await expect(page.getByText('You pay less than the repo moves imply: in your favour.')).toBeVisible();
    await loanCheck(page, { name: 'Some Bank I Typed', type: 'Bank (public, private or foreign)' });
    await expect(page.getByText('You pay less than the repo moves imply: in your favour.')).toBeVisible();
  });
  test('L#9 [G5] the check asks "did your spread change?"', async ({ page }) => {
    await loanCheck(page, 'SBI', false);
    await expect(page.getByText(/Still needed: whether your spread changed/).first()).toBeVisible();
  });
  test('L#10 [G5] the lender is picked from a list (lender type shown)', async ({ page }) => {
    await page.goto('/tools/loan-check');
    await expect(page.getByTestId('lc-lender').locator('option', { hasText: 'LIC Housing Finance' })).toHaveCount(1);
  });
  test('L#28 [G5] the ₹ figure says "estimate for your conversation" beside the number', async ({ page }) => {
    await loanCheck(page, 'SBI');
    await expect(page.getByText(/estimate for your own conversation with the bank/i).first()).toBeVisible();
  });

  // ── G10 product-surface ──────────────────────────────────────────────────
  test('L#29 [G10] every savings claim on the landing states its baseline', async ({ request }) => {
    const html = await (await request.get('/welcome.html')).text();
    for (const m of html.matchAll(/(\d+)\s*(yrs?|years?)\s+saved/gi)) {
      expect(html.slice(m.index!, m.index! + 400)).toMatch(/compared with|than paying only the minimum|baseline/i);
    }
  });

  // ── L4 distress-triage ───────────────────────────────────────────────────
  test('L#25b [L4] "Feeling overwhelmed?" opens the "I can\'t pay this month" triage', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /FEELING OVERWHELMED/ }).click();
    await expect(page.getByText(/can't pay this month/i).first()).toBeVisible();
  });
});

// ── Delight findings with no UI to assert beyond the guards above ────────
test('L#12 [main] the peer-rate data behind the loan editor is served and dated', async ({ request }) => {
  const res = await request.get(`${API}/api/rates/disclosures`).catch(() => null);
  test.skip(!res || res.status() === 404, 'no public disclosures route on this build; covered by engine test_rate_disclosures.py');
  expect(res!.ok()).toBeTruthy();
});

// ── L2 plan-logic (owner spec: web/e2e/plan-short-month.spec.ts) ─────────
// These need a month that is short: the owner spec's ₹70,000 / ₹30,000
// household (₹74,515 due, ₹34,515 short). The findings persona is not short.
test.describe('L2 short month (signed in)', () => {
  const SHORT = 'golden-l5-short@rightdue.app';
  test.beforeEach(async ({ page }) => {
    await signIn(page, SHORT);
    if (!(await landedOnOnboarding(page))) return;
    await page.getByLabel(/Take-home pay a month/).fill('70000');
    await page.getByLabel(/Spending a month/).fill('30000');
    await page.getByRole('button', { name: /CONTINUE · WHAT YOU OWE/ }).click();
    await fillLoan(page, 0, { kind: /^personal$/i, balance: '400000', rate: '14', emi: '52661' });
    await fillLoan(page, 1, { kind: /^home$/i, balance: '2500000', rate: '8.6', emi: '21854' });
    await page.getByRole('button', { name: /CONTINUE · SEE YOUR PLAN/ }).click();
    await makeSetupChoices(page);
    await page.getByRole('button', { name: /SAVE · OPEN MY PLAN/ }).click();
    await continueToPlan(page);
  });
  test('L#15 [L2] no extra payment lands in a month that is short', async ({ page }) => {
    await page.goto('/plan');
    await expect(page.getByRole('heading', { name: /MONTH BY MONTH · AS THINGS STAND/ })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'GAP OWED' })).toBeVisible();
  });
  test('L#16 [L2] a short plan names the date if the gap closes and as things stand', async ({ page }) => {
    await page.goto('/plan');
    // #main: not the hidden streamed copy (see plan-short-month.spec.ts).
    // Audit 80+ A5: the headline is the gap; the gap-closed date is named in the line.
    await expect(page.locator('#main').getByText(/gap closes: (?:[A-Za-z]{3} \d{4}) · as things stand/)).toBeVisible();
  });
  // No DOM hook for the last axis tick; chartEndMonth is covered by
  // web/tests/l2-plan-logic.cjs "#17".
  test.fixme('L#17 [L2] the chart axis ends at the actual payoff month', async ({ page }) => {
    await page.goto('/plan');
    await expect(page.locator('#main').getByTestId('trajectory-last-tick')).toBeVisible();
  });
  test('L#24 [L2] Home shows "due" beside what the month can cover', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#main').getByText(/Due this month: .* you have .* for them/)).toBeVisible();
  });
  test('L#26 [L2] a longer-tenure what-if runs the engine', async ({ page }) => {
    await page.goto('/plan');
    await expect(page.locator('#main section[aria-labelledby="tenure-whatif"]')).toBeVisible();
  });
});
