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
import { expect, fillLoan, isPlanCall, signIn, test, makeSetupChoices } from './fixtures';

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
    const res = page.waitForResponse(isPlanCall('/api/simulate'));
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
  });

  await test.step('Plan: both dates named, due beside what the month covers', async () => {
    await makeSetupChoices(page);
    await page.getByRole('button', { name: /SAVE · OPEN MY PLAN/ }).click();
    await page.waitForURL('**/plan');
    await expect(page.getByText(/GAP CLOSES · AS THINGS STAND/)).toBeVisible();
    await expect(page.getByText('DUE THIS MONTH')).toBeVisible();
    await expect(page.getByText(/YOU CAN COVER ₹40,000 · SHORT ₹34,515/)).toBeVisible();
    await expect(page.getByText(/borrowed on a card at 45% a year plus 18% GST/)).toBeVisible();
    await expect(page.getByRole('heading', { name: /MONTH BY MONTH · AS THINGS STAND/ })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'GAP OWED' })).toBeVisible();
    await expect(page.getByText(/BORROWED ON A CARD AT 45%/).first()).toBeVisible();
  });

  await test.step('#26: a longer tenure on the home loan, through the engine', async () => {
    const box = page.locator('section[aria-labelledby="tenure-whatif"]');
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
    await expect(page.getByText(/Due this month: ₹74,515 in EMIs and minimums\. After your costs you have ₹40,000 for them, so you're ₹34,515 short\./)).toBeVisible();
    await expect(page.getByText(/GAP CLOSES · PLAN →/)).toBeVisible();
  });
});
