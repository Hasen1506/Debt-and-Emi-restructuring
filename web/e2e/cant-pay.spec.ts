/**
 * Sprint L4: "I can't pay this month" triage, from Home's soft view.
 * A Chennai borrower whose take-home minus spending (₹50,000) can't cover
 * a ₹35,000 home EMI, a ₹15,000 car EMI and a card minimum: the page keeps
 * the home and car loans whole and shows the card minimum as short.
 */
import { expect, fillLoan, signIn, test } from './fixtures';

test('India: Feeling overwhelmed → can\u2019t pay this month → protect order, cost, letter, rights', async ({ page }) => {
  await signIn(page, 'golden-cantpay@rightdue.app');
  await page.getByLabel(/Take-home pay a month/).fill('90000');
  await page.getByLabel(/Spending a month/).fill('40000');
  await page.getByRole('button', { name: /CONTINUE · WHAT YOU OWE/ }).click();
  await fillLoan(page, 0, { kind: /^home$/i, balance: '3500000', rate: '8.5', emi: '35000' });
  await fillLoan(page, 1, { kind: /^car$/i, balance: '500000', rate: '9', emi: '15000' });
  await fillLoan(page, 2, { kind: /^card$/i, balance: '85000', rate: '42' });
  await page.getByRole('button', { name: /CONTINUE · SEE YOUR PLAN/ }).click();
  await page.getByRole('button', { name: /SAVE · OPEN MY PLAN/ }).click();
  await page.waitForURL('**/plan');

  await page.goto('/');
  await page.getByText('FEELING OVERWHELMED? ONE STEP AT A TIME').click();
  await page.getByRole('link', { name: /CAN.T PAY THIS MONTH/ }).click();
  await page.waitForURL('**/cant-pay');

  const rows = page.getByTestId('cp-protect-row');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText('Home loan');
  await expect(rows.nth(0)).toContainText('COVERED');
  await expect(rows.nth(1)).toContainText('Car loan');
  await expect(rows.nth(1)).toContainText('COVERED');
  await expect(rows.nth(2)).toContainText('minimum due');
  await expect(rows.nth(2)).toContainText('SHORT');

  await expect(page.getByTestId('cp-cost')).toContainText('not entered: check');
  await expect(page.getByLabel('Hardship letter draft')).toHaveValue(/^DRAFT/);
  await expect(page.getByTestId('cp-rights')).toContainText('before 8:00 a.m. or after 7:00 p.m.');
  await expect(page.getByTestId('cp-settle')).toContainText('at least 12 months');
  await expect(page.getByRole('link', { name: /LONGER TENURE WHAT-IF/ })).toHaveAttribute('href', '/plan');
});
