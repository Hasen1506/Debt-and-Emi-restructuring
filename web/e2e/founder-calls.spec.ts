/**
 * Founder calls, 19 Oct 2026: the chart stops at payoff, the schedule says
 * how many months it is showing, the spend slider nudges by 100, the debt
 * choice names the EMIs, windfall sliders move without MY SPLIT, what-if
 * and calculators say they are not saved, and a closed credit line is not
 * a dead checkbox.
 */
import { expect, fillLoan, landedOnOnboarding, makeSetupChoices, signIn, test, continueToPlan } from './fixtures';

async function planOpen(page: import('@playwright/test').Page, email: string) {
  await signIn(page, email);
  if (await landedOnOnboarding(page)) {
    await page.getByLabel(/Take-home pay a month/).fill('80000');
    await page.getByLabel(/Spending a month/).fill('30000');
    await page.getByRole('button', { name: /CONTINUE · WHAT YOU OWE/ }).click();
    await fillLoan(page, 0, { kind: /^home$/i, balance: '2500000', rate: '8.5', emi: '21696', emiGoneOut: 'due' });
    await page.getByRole('button', { name: /CONTINUE · SEE YOUR PLAN/ }).click();
    await makeSetupChoices(page);
    await page.getByRole('button', { name: /SAVE · OPEN MY PLAN/ }).click();
    await continueToPlan(page);
  } else {
    await page.goto('/plan');
  }
}

test('the schedule says how many months are showing, and Show all opens the rest', async ({ page }) => {
  await planOpen(page, 'r3-schedule@rightdue.app');
  const showing = page.getByTestId('schedule-showing');
  await expect(showing).toContainText(/Showing \d+ of \d+ months/);
  const before = await page.locator('#schedule tr[data-month]').count();
  await page.getByRole('button', { name: 'SHOW ALL', exact: true }).click();
  await expect(page.getByRole('button', { name: 'EVENTS ONLY', exact: true })).toBeVisible();
  await expect.poll(async () => page.locator('#schedule tr[data-month]').count()).toBeGreaterThan(before);
});

test('the debt choice is named EMIs + all spare cash', async ({ page }) => {
  await planOpen(page, 'r3-budget-name@rightdue.app');
  await expect(page.getByRole('button', { name: /EMIs \+ all spare cash/i })).toBeVisible();
});

test('spend less: the slider steps by 500, + and − by 100, and a typed amount stays exact', async ({ page }) => {
  await planOpen(page, 'r3-spend-step@rightdue.app');
  await page.locator('#what-if').scrollIntoViewIfNeeded();
  const box = page.getByRole('textbox', { name: 'Spend less' });
  await box.fill('150');
  await box.blur();
  await expect(box).toHaveValue('150');
  await page.getByRole('button', { name: 'Increase Spend less by 100' }).click();
  await expect(box).toHaveValue('250');
  await page.getByRole('button', { name: 'Decrease Spend less by 100' }).click();
  await expect(box).toHaveValue('150');
  const slider = page.getByRole('slider', { name: 'Spend less' });
  await expect(slider).toHaveAttribute('step', '500');
  await expect(page.getByTestId('not-saved').first()).toContainText('Not saved');
});

test('a windfall slider moves without MY SPLIT and the cushion takes the difference', async ({ page }) => {
  await planOpen(page, 'r3-windfall@rightdue.app');
  await page.goto('/tools/windfall');
  await expect(page.getByTestId('not-saved')).toContainText('Not saved');
  await page.getByLabel('Amount, after tax').fill('100000');
  const home = page.getByRole('slider', { name: /home loan: amount/i });
  await expect(home).toBeEnabled({ timeout: 20000 });
  const before = Number(await home.inputValue());
  const max = Number(await home.getAttribute('max'));
  const next = Math.max(1, Math.round(max / 2));
  await home.fill(String(before === next ? Math.max(1, Math.round(max / 4)) : next));
  await expect.poll(async () => Number(await home.inputValue())).not.toBe(before);
});

test('a closed credit-report line says there is nothing to add', async ({ page }) => {
  await planOpen(page, 'r3-closed-line@rightdue.app');
  await page.goto('/profile?step=loans');
  await expect(page.getByLabel('Outstanding balance')).toBeVisible();
  await page.getByTestId('cr-open').click();
  const text = page.getByTestId('cr-text');
  await text.fill([
    'Subscriber Name: OLD AUTO FINANCE',
    'Account Type: Auto Loan',
    'Account No: AU0001',
    'Current Balance: Rs 0',
    'Account Status: Closed',
    'Date Reported: 01/01/2024',
    'Subscriber Name: SAMPLE BANK LTD',
    'Account Type: Personal Loan',
    'Account No: PL1',
    'Current Balance: Rs 100000',
    'Account Status: Active',
    'Date Reported: 01/10/2026',
  ].join('\n'));
  await page.getByRole('button', { name: 'Read the text' }).click();
  await expect(page.getByTestId('cr-closed')).toContainText('Closed, nothing to add');
  await expect(page.getByTestId('cr-closed').locator('input')).toHaveCount(0);
});
