/**
 * Sprint L2: the live-test stress case, end to end (grill #38, live tests
 * #15, #16, #17, #24, #26). A salaried borrower in Chennai whose take-home
 * (₹70,000) can't cover spending plus a personal loan and a home loan EMI.
 *
 *  - #38: the short month is borrowed at a card rate and repaid first;
 *  - #15: no "extra" lands on a loan while a month is short;
 *  - #16: the headline names the date if the gap closes and the date as
 *    things stand, and the schedule says "as things stand";
 *  - #24: "due" beside what the month can cover, on Plan and on Home;
 *  - #26: a longer-tenure what-if runs the engine and shows the new EMI.
 */
import { expect, fillLoan, isSetupPlanCall, signIn, test, makeSetupChoices } from './fixtures';

const EMAIL = 'golden-short-month@rightdue.app';

test('Short month: gap borrowed at card rates, both dates named, due vs affordable, tenure what-if', async ({ page }) => {
  await test.step('sign in and set up a month that is short', async () => {
    await signIn(page, EMAIL);
    await expect(page).toHaveURL(/\/onboarding$/);
    await page.getByLabel(/Take-home pay a month/).fill('70000');
    await page.getByLabel(/Spending a month/).fill('30000');
    await page.getByRole('button', { name: /CONTINUE · WHAT YOU OWE/ }).click();
    await fillLoan(page, 0, { kind: /^personal$/i, balance: '400000', rate: '14', emi: '52661' });
    await fillLoan(page, 1, { kind: /^home$/i, balance: '2500000', rate: '8.6', emi: '21854' });
  });

  let sim: { shortfall: string; gap_rate: string; total_gap_interest: string; trajectory: Record<string, string>[] };
  await test.step('the plan preview borrows the gap instead of assuming it', async () => {
    const res = page.waitForResponse(isSetupPlanCall());
    await page.getByRole('button', { name: /CONTINUE · SEE YOUR PLAN/ }).click();
    sim = await (await res).json();
    // ₹70,000 − ₹30,000 = ₹40,000 against ₹74,515 of EMIs: ₹34,515 short.
    expect(Number(sim.shortfall)).toBeCloseTo(34515, 0);
    expect(Number(sim.trajectory[0].gap_borrowed)).toBeCloseTo(34515, 0);
    expect(Number(sim.gap_rate)).toBe(0.45);
    expect(Number(sim.total_gap_interest)).toBeGreaterThan(0);
    // #15: nothing extra goes to a loan in a month that is short.
    for (const p of sim.trajectory) if (Number(p.shortfall) > 0) expect(Number(p.extra_paid)).toBe(0);
    await expect(page.getByText(/borrows it on a card at card rates/)).toBeVisible();
    // R7-2: Setup's headline uses the same helper and words as Plan and Home.
    // Audit 80+ A5: the gap is the headline; the date it would take to close it
    // is named in the note. (UI revert 18 Oct 2026: Setup step 3 is the 4bc3dc8
    // layout, so the gap card itself is on Home, not here.)
    await expect(page.getByTestId('gap-headline')).toHaveCount(0);
    await expect(page.getByText(/^₹34,515\/mo short$/).first()).toBeVisible();
    await expect(page.getByText(/^if the ₹34,515\/mo gap closes: [A-Z][a-z]{2} \d{4} · as things stand: (?:[A-Z][a-z]{2} \d{4}|not in 30 years|not fundable from [A-Z][a-z]{2} \d{4})$/).first()).toBeVisible();
  });

  await test.step('Plan: both dates named, due beside what the month covers', async () => {
    await makeSetupChoices(page);
    await page.getByRole('button', { name: /SAVE · OPEN MY PLAN/ }).click();
    await page.waitForURL('**/plan');
    // The page's text, not the server's streamed copy of it: until React
    // reveals it, the plan arrives in a hidden <div id="S:0"> at the end of
    // <body>, and when the account copy's refresh renders the plan into
    // #main first, both are in the DOM for a moment (CI run 38337335511:
    // strict-mode "2 elements", the second outside #main and hidden).
    const main = page.locator('#main');
    await expect(main.getByText(/GAP CLOSES: [A-Z]{3} \d{4} · AS THINGS STAND/)).toBeVisible();
    await expect(main.getByText('₹34,515/MO SHORT').first()).toBeVisible();
    await expect(main.getByText('DUE THIS MONTH', { exact: true })).toBeVisible();
    await expect(main.getByText(/YOU CAN COVER ₹40,000 · SHORT ₹34,515/)).toBeVisible();
    await expect(main.getByText(/borrowed on a card at 45% a year plus 18% GST/)).toBeVisible();
    await expect(page.getByRole('heading', { name: /MONTH BY MONTH · AS THINGS STAND/ })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'GAP OWED' })).toBeVisible();
    // B18 (W7): the month also has a phone card (hidden at this width) ahead
    // of the table row in the DOM; read the one the user sees.
    await expect(main.getByText(/BORROWED ON A CARD AT 45%/).filter({ visible: true }).first()).toBeVisible();
  });

  await test.step('#26: a longer tenure on the home loan, through the engine', async () => {
    const box = page.locator('#main section[aria-labelledby="tenure-whatif"]');
    const select = box.getByLabel('Loan to stretch');
    const opts = await select.locator('option').allInnerTexts();
    await select.selectOption({ index: opts.findIndex((o) => /home loan/i.test(o)) });
    const compare = page.waitForResponse(
      (r) => r.request().method() === 'POST' && r.url().endsWith('/api/sensitivity/compare') && r.ok(),
    );
    await box.getByRole('button', { name: '+10 YRS' }).click();
    const body = await (await compare).json();
    expect(Number(body.tenure_new_emi)).toBeLessThan(Number(body.tenure_old_emi));
    expect(Number(body.scenario_shortfall)).toBeLessThan(Number(body.baseline_shortfall));
    await expect(box.getByRole('status')).toContainText('EMI ₹21,854 →');
    await expect(box.getByRole('link', { name: /RBI circular of 18 Aug 2023/ })).toBeVisible();
  });

  await test.step('Home: what is due beside what the month covers', async () => {
    await page.goto('/');
    // Home streams its figures the same way: read them in #main.
    const main = page.locator('#main');
    await expect(main.getByText(/Due this month: ₹74,515 in EMIs and minimums\. After your costs you have ₹40,000 for them, so you're ₹34,515 short\./)).toBeVisible();
    // Live re-test 7 R7-2 (golden updated on purpose): Home now names the
    // as-is date too, in the same words as Plan and Setup (answers L2 #16).
    await expect(main.getByText(/IF THE ₹34,515\/MO GAP CLOSES: [A-Z]{3} \d{4} · AS THINGS STAND: (?:[A-Z]{3} \d{4}|NOT IN 30 YEARS|NOT FUNDABLE FROM [A-Z]{3} \d{4}) · PLAN →/)).toBeVisible();
    // Audit 80+ A5: Home's big figure is the gap, not a conditional date.
    await expect(main.getByText('₹34,515/MO SHORT').first()).toBeVisible();
  });
});
