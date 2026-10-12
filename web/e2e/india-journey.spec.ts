/**
 * Golden journey 1: an Indian salaried borrower with a home loan, a credit
 * card and a US-dollar car loan. Signs in by emailed code, sets up, reads
 * the plan, tries a lump-sum what-if, moves to the USA (amounts converted at
 * the stubbed FX rate), checks /tax, and signs out (local data cleared).
 *
 * Every figure asserted here comes from the real engine on fixed inputs:
 * fixed FX (1 USD = ₹83.25), fixed day (7 Oct 2026), fixed OTP.
 */
import { expect, fillLoan, isPlanCall, money, planSummary, planText, signIn, test, makeSetupChoices } from './fixtures';

const EMAIL = 'golden-india@rightdue.app';

test('India: sign in, set up three loans, plan, what-if, switch to USA, tax, sign out', async ({ page, context }) => {
  await test.step('sign in with the emailed code', async () => {
    await signIn(page, EMAIL);
    await expect(page).toHaveURL(/\/onboarding$/);
    await expect(page.getByText('01 / YOU AND YOUR MONEY')).toBeVisible();
  });

  await test.step('onboarding: income and spending', async () => {
    await page.getByLabel(/Take-home pay a month/).fill('150000');
    await page.getByLabel(/Spending a month/).fill('40000');
    await page.getByRole('button', { name: /CONTINUE · WHAT YOU OWE/ }).click();
    await expect(page.getByText('02 / WHAT YOU OWE')).toBeVisible();
  });

  await test.step('onboarding: an INR home loan, an INR card and a USD car loan', async () => {
    await fillLoan(page, 0, { kind: /^home$/i, balance: '3500000', rate: '8.5', emi: '35000' });
    await fillLoan(page, 1, { kind: /^card$/i, balance: '85000', rate: '42' });
    await fillLoan(page, 2, { kind: /^car$/i, currency: 'USD', balance: '12000', rate: '6.9', emi: '400' });
    // The USD loan asks for today's rate, filled from the stubbed FX feed.
    const fx = page.getByLabel('1 USD in INR');
    await expect(fx).toHaveValue('83.25');
    await expect(page.getByText("Today's rate, 2026-10-01")).toBeVisible();
    // ₹1,50,000 − ₹40,000 = ₹1,10,000; EMIs ₹35,000 + $400 × 83.25 = ₹68,300.
    await expect(page.getByText('₹1,10,000 − ₹68,300 in EMIs')).toBeVisible();
    await expect(page.getByText('₹41,700', { exact: true })).toBeVisible();
  });

  await test.step('onboarding: plan preview (golden)', async () => {
    const sim = page.waitForResponse(isPlanCall('/api/simulate'));
    await page.getByRole('button', { name: /CONTINUE · SEE YOUR PLAN/ }).click();
    expect(JSON.stringify(await planSummary(await sim), null, 2)).toMatchSnapshot('india-onboarding-simulate.json');
    await expect(page.getByText('Nov 2030')).toBeVisible();
    await expect(page.getByText('₹8,57,983')).toBeVisible();
    await expect(page.getByText(/put ₹37,450 extra on your credit card/)).toBeVisible();
  });

  await test.step('save and open the plan (golden schedule)', async () => {
    await makeSetupChoices(page);
    await page.getByRole('button', { name: /SAVE · OPEN MY PLAN/ }).click();
    await page.waitForURL('**/plan');
    await expect(page.getByText('NOV 2030').first()).toBeVisible();
    await expect(page.getByText('₹8,57,983').first()).toBeVisible();
    await expect(page.getByText('₹22,72,461 LESS THAN MINIMUMS')).toBeVisible();
    expect(await planText(page)).toMatchSnapshot('india-plan-schedule.txt');
  });

  await test.step('what-if: a ₹50,000 lump sum on the card', async () => {
    const whatIf = page.locator('#what-if');
    const compare = page.waitForResponse((r) => r.request().method() === 'POST' && r.url().endsWith('/api/sensitivity/compare') && r.ok());
    // The amount box commits on Enter/blur (typing alone only edits a draft).
    const lump = whatIf.getByRole('textbox', { name: 'Pay a lump sum' });
    await lump.fill('50000');
    await lump.press('Enter');
    const body = await (await compare).json();
    expect(Number(body.interest_saved)).toBeGreaterThan(0);
    expect(Number(body.scenario_total_interest)).toBeLessThan(Number(body.baseline_total_interest));
    await expect(whatIf.getByText('₹26,162 less interest')).toBeVisible();
    await expect(whatIf.getByText('₹8,31,821')).toBeVisible();
  });

  await test.step('switch country to the USA, converting at the stubbed rate', async () => {
    await page.goto('/profile');
    await page.getByRole('button', { name: 'Edit Where you live and tax' }).click();
    await page.getByLabel('Country', { exact: true }).selectOption('US');
    const dialog = page.getByRole('dialog', { name: 'Change country' });
    await expect(dialog.getByText('Your amounts are in ₹. The USA uses $.')).toBeVisible();
    await expect(dialog.getByRole('textbox')).toHaveValue(/^0\.0120120/);
    await dialog.getByRole('checkbox').uncheck();
    await dialog.getByRole('button', { name: 'CONVERT AND SWITCH TO USA' }).click();
    await expect(page.getByText(/Converted at ₹1 = \$0\.0120120\d*\. Your loans were converted too\./)).toBeVisible();
    await page.getByRole('button', { name: /SAVE CHANGES/ }).click();
    await expect(page.getByText('Saved. Home and Plan use the new numbers.')).toBeVisible();
    await expect(page.getByText('$1,801.80 a month')).toBeVisible();
    // Each converted loan keeps its cents, and the rows add up to the total.
    const table = page.locator('table').filter({ hasText: 'OWED' });
    const owed = (name: string) => table.getByRole('row', { name: new RegExp(`^${name}`) }).getByRole('cell').first();
    await expect(owed('Home loan')).toHaveText('$42,042.04');
    await expect(owed('Credit card')).toHaveText('$1,021.02');
    await expect(owed('Car loan')).toHaveText('$12,000.00');
    const total = await owed('Total').innerText();
    expect(total).toBe('$55,063.06');
    expect(money('$42,042.04') + money('$1,021.02') + money('$12,000.00')).toBeCloseTo(money(total), 2);
  });

  await test.step('the plan is now in dollars (golden schedule)', async () => {
    await page.goto('/plan');
    await expect(page.getByText('FILING SINGLE', { exact: false })).toBeVisible();
    await expect(page.getByText('$10,291').first()).toBeVisible();
    expect(await planText(page)).toMatchSnapshot('india-to-usa-plan-schedule.txt');
  });

  await test.step('Profile and /tax show the US filing details', async () => {
    // /tax is its own page again (sprint G2, grill #77); Profile's tax
    // section links to it.
    await page.goto('/profile');
    await expect(page.getByText(/^USA(,| with|$)/).first()).toBeVisible();
    await expect(page.getByText(/^Single( ·|$)/).first()).toBeVisible();
    // Roadmap PR A: the bracket is re-estimated for the US from the $1,801.80
    // take-home (10%). It used to keep India's 20.8% after the switch, which
    // is how a high earner ended up on a stale 0% (lib/marginal-rate).
    await expect(page.getByText('10.0%')).toBeVisible();
    await expect(page.getByText('20.8%')).toHaveCount(0);
    await page.goto('/tax');
    await expect(page.getByRole('heading', { name: /Tax and your loans/i })).toBeVisible();
    await expect(page.getByText('20.8%')).toHaveCount(0);
  });

  await test.step('sign out clears this browser', async () => {
    expect((await context.cookies()).map((c) => c.name)).toContain('rightdue_user');
    await page.getByRole('button', { name: /SIGN OUT/ }).click();
    await page.waitForURL('**/login');
    await expect.poll(async () => (await context.cookies()).map((c) => c.name)).toEqual([]);
    expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([]);
    await page.goto('/plan');
    await expect(page).toHaveURL(/\/login\?next=%2Fplan$/);
  });
});
