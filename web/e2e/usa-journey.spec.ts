/**
 * Golden journey 2: a US borrower with a mortgage, a credit card and a
 * student loan, plus a rupee loan back in India (NRI). Signs in, sets up,
 * reads the plan, checks /tax, signs out; then signs in again on a clean
 * browser and gets the saved plan back from the account.
 */
import { expect, fillLoan, isSetupPlanCall, planSummary, planText, signIn, test, makeSetupChoices } from './fixtures';

const EMAIL = 'golden-usa@rightdue.app';

test('USA: set up a mortgage, a card, a student loan and an INR loan; plan; tax; sign out and back in', async ({ page, context, browser }) => {
  await test.step('sign in and choose the USA', async () => {
    await signIn(page, EMAIL);
    await expect(page).toHaveURL(/\/onboarding$/);
    await page.getByRole('group', { name: 'Where you live' }).getByRole('button', { name: /USA/ }).click();
    // R3C-1: Setup asks how a US filer files (no silent Single).
    await page.getByRole('group', { name: 'How you file your tax return' }).getByRole('button', { name: /^Single$/ }).click();
    await page.getByLabel(/Take-home pay a month/).fill('7800');
    await page.getByLabel(/Spending a month/).fill('2500');
    await page.getByRole('button', { name: /CONTINUE · WHAT YOU OWE/ }).click();
  });

  await test.step('loans in dollars and one in rupees', async () => {
    await fillLoan(page, 0, { kind: /^home$/i, balance: '320000', rate: '6.75', emi: '2100' });
    await fillLoan(page, 1, { kind: /^card$/i, balance: '6500', rate: '24.99' });
    await fillLoan(page, 2, { kind: /^education$/i, balance: '28000', rate: '5.5', emi: '300' });
    await fillLoan(page, 3, { kind: /^personal$/i, currency: 'INR', balance: '500000', rate: '11', emi: '12000' });
    const fx = page.getByLabel('1 INR in USD');
    await expect(fx).toHaveValue(/^0\.0120120/);
  });

  await test.step('plan preview (golden)', async () => {
    const sim = page.waitForResponse(isSetupPlanCall());
    await page.getByRole('button', { name: /CONTINUE · SEE YOUR PLAN/ }).click();
    expect(JSON.stringify(await planSummary(await sim), null, 2)).toMatchSnapshot('usa-onboarding-simulate.json');
  });

  await test.step('saved plan (golden schedule)', async () => {
    await makeSetupChoices(page);
    await page.getByRole('button', { name: /SAVE · OPEN MY PLAN/ }).click();
    await page.waitForURL('**/plan');
    await expect(page.locator('#main').getByText('FILING SINGLE', { exact: false })).toBeVisible();
    expect(await planText(page)).toMatchSnapshot('usa-plan-schedule.txt');
  });

  await test.step('R8-2 / R9-1: US pages and every US tool say "monthly payment", never EMI', async () => {
    // R9-1: every tool a US borrower can open (Loan Check is India-only; NRI
    // prepay is about an Indian loan), and New debt in both modes (Big
    // purchase lives at ?mode=purchase).
    for (const url of ['/plan', '/', '/activity', '/tools/new-debt', '/tools/new-debt?mode=purchase', '/tools/windfall', '/tools/liquidate', '/tools/invest-vs-prepay']) {
      await page.goto(url);
      await expect(page.locator('#main')).toBeVisible();
      const text = await page.locator('#main').innerText();
      expect(text, url).not.toMatch(/\bEMIS?\b/);
    }
  });

  await test.step('Profile and /tax show the US details', async () => {
    // /tax is its own page again (sprint G2, grill #77).
    await page.goto('/profile');
    await expect(page.getByText(/^USA(,| with|$)/).first()).toBeVisible();
    await expect(page.getByText(/^Single( ·|$)/).first()).toBeVisible();
    await page.goto('/tax');
    await expect(page.getByRole('heading', { name: /Tax and your loans/i })).toBeVisible();
  });

  let debtFree = '';
  await test.step('sign out clears this browser', async () => {
    await page.goto('/plan');
    // Whitespace dropped: innerText's line breaks depend on whether the
    // stylesheet has applied yet, which made a cold first run differ.
    debtFree = (await page.getByText(/^DEBT-FREE$/).first().locator('xpath=..').innerText()).replace(/\s+/g, '');
    expect(debtFree).toMatch(/^DEBT-FREE[A-Z]{3}\d{4}/);
    await page.getByRole('button', { name: /SIGN OUT/ }).click();
    await page.waitForURL('**/login');
    await expect.poll(async () => (await context.cookies()).length).toBe(0);
    expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([]);
  });

  await test.step('signing in again on a new browser restores the saved plan', async () => {
    const fresh = await browser.newContext();
    await fresh.route((u) => !/^(localhost|127\.0\.0\.1)$/.test(u.hostname), (r) => r.abort('blockedbyclient'));
    const p2 = await fresh.newPage();
    await p2.clock.setFixedTime(new Date(process.env.E2E_FROZEN_NOW ?? '2026-10-07T04:30:00.000Z'));
    await signIn(p2, EMAIL);
    await p2.goto('/plan');
    await expect(p2.locator('#main').getByText('FILING SINGLE', { exact: false })).toBeVisible();
    const again = (await p2.getByText(/^DEBT-FREE$/).first().locator('xpath=..').innerText()).replace(/\s+/g, '');
    expect(again).toBe(debtFree);
    await fresh.close();
  });
});
