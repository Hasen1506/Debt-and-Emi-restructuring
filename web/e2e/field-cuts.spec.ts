/**
 * Field cuts, 19 Oct 2026: a rate is filled from the banks' published
 * rates when the kind of loan is chosen, months and the EMI stand in for
 * each other, rare loan inputs stay under More options, and a saved loan
 * is not typed again on Sell to repay.
 */
import { expect, fillLoan, landedOnOnboarding, makeSetupChoices, signIn, test, continueToPlan } from './fixtures';

async function savedHomeLoan(page: import('@playwright/test').Page, email: string) {
  await signIn(page, email);
  if (!(await landedOnOnboarding(page))) return;
  await page.getByLabel(/Take-home pay a month/).fill('90000');
  await page.getByLabel(/Spending a month/).fill('40000');
  await page.getByRole('button', { name: /CONTINUE · WHAT YOU OWE/ }).click();
  await fillLoan(page, 0, { kind: /^home$/i, balance: '2500000', rate: '8.5', emi: '21696', emiGoneOut: 'due' });
  await page.getByRole('button', { name: /CONTINUE · SEE YOUR PLAN/ }).click();
  await makeSetupChoices(page);
  await page.getByRole('button', { name: /SAVE · OPEN MY PLAN/ }).click();
  await continueToPlan(page);
}

test('choosing a home loan fills the rate, and months left work out the EMI', async ({ page }) => {
  await signIn(page, 'r3-rate-prefill@rightdue.app');
  await page.getByLabel(/Take-home pay a month/).fill('90000');
  await page.getByLabel(/Spending a month/).fill('40000');
  await page.getByRole('button', { name: /CONTINUE · WHAT YOU OWE/ }).click();
  const loan = page.locator('[role=group]').filter({ has: page.getByRole('group', { name: 'Kind of loan' }) }).first();
  await loan.getByRole('button', { name: /^home$/i }).click();
  const rate = loan.getByLabel('Interest rate, % a year');
  await expect(rate).not.toHaveValue('');
  await expect(loan.getByText(/Typical for this kind of loan/)).toBeVisible();
  await expect(loan.getByRole('button', { name: /I DON'T KNOW THE RATE/ })).toHaveCount(0);
  await loan.getByLabel('Balance left to repay').fill('2500000');
  await loan.getByRole('button', { name: /I KNOW THE MONTHS LEFT INSTEAD/ }).click();
  await loan.getByLabel('Months left').fill('240');
  await expect(loan.getByText(/works out to/)).toBeVisible();
});

test('profile hides rare loan inputs until More options, and shows a worked-out EMI', async ({ page }) => {
  await savedHomeLoan(page, 'r3-more-options@rightdue.app');
  await page.goto('/profile?step=loans');
  await expect(page.getByLabel('Outstanding balance')).toBeVisible();
  const more = page.getByTestId('loan-more-options');
  await expect(more).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByLabel('Processing fee a year (%, optional)')).toHaveCount(0);
  await expect(page.getByLabel('Prepayment fee (%, optional)')).toHaveCount(0);
  await expect(page.getByLabel("Bank's reset frequency")).toHaveCount(0);
  const tenure = page.getByLabel('Tenure remaining (months)');
  await expect(tenure).not.toHaveValue('');
  await tenure.fill(await tenure.inputValue());
  await tenure.blur();
  await more.click();
  await expect(more).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByLabel('Processing fee a year (%, optional)')).toBeVisible();
  await expect(page.getByLabel('Prepayment fee (%, optional)')).toBeVisible();
  await expect(page.getByLabel("Bank's reset frequency")).toBeVisible();
  const emi = page.getByLabel('Bank-required EMI');
  await emi.fill('');
  await emi.blur();
  await expect(emi).not.toHaveValue('');
  await expect(page.getByText(/Worked out from the balance, rate and months left/)).toBeVisible();
});

test('sell to repay uses the saved loan instead of asking for it again', async ({ page }) => {
  await savedHomeLoan(page, 'r3-liquidate-loan@rightdue.app');
  await page.goto('/tools/liquidate');
  await page.getByRole('button', { name: /home loan/i }).first().click();
  await expect(page.getByLabel('Still owed')).toHaveCount(0);
  await expect(page.getByLabel('Its rate (%)')).toHaveCount(0);
  await expect(page.getByText(/still owed/)).toBeVisible();
  await page.getByRole('button', { name: 'EDIT', exact: true }).click();
  await expect(page.getByLabel('Still owed')).toBeVisible();
});
