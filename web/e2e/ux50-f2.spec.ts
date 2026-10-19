/**
 * UX50 round, fix agent F2 (Setup, Home, Plan), ux50/B.md:
 *  - B-35: blank spending stops step 1 with a plain ask; a typed 0 needs a yes.
 *  - B-10: browser Back on step 2 goes to step 1 (not the page before
 *    Setup), and a reload keeps what was typed.
 *  - B-02: right after Setup, Home doesn't ask "Welcome back… is it yours?".
 *  - B-11: Home opens with one "THIS MONTH" line.
 *  - B-01: the row that gets the extra says so, and keeps saying so once paid;
 *    both Home lists number the card the same.
 *  - B-12: marking the card paid moves its balance and the total.
 */
import { expect, fillLoan, makeSetupChoices, planPreviewSettled, signIn, test, continueToPlan } from './fixtures';

const shots = process.env.FIX4_SHOTS;

test('UX50 B-35/B-10/B-02/B-11/B-01/B-12: Setup keeps its place, Home says what to do', async ({ page }) => {
  await signIn(page, 'golden-ux50-f2@rightdue.app');
  await expect(page).toHaveURL(/\/onboarding$/);

  // B-35: spending left blank is not ₹0.
  await page.getByLabel(/Take-home pay a month/).fill('95000');
  await page.getByRole('button', { name: /CONTINUE · WHAT YOU OWE/ }).click();
  await expect(page.getByText(/Enter about how much you spend a month/)).toBeVisible();
  await expect(page).not.toHaveURL(/step=loans/);
  // A typed 0 asks first.
  await page.getByLabel(/Spending a month/).fill('0');
  await expect(page.getByTestId('zero-spend-confirm')).toContainText('₹0 spending?');
  await page.getByRole('button', { name: /CONTINUE · WHAT YOU OWE/ }).click();
  await expect(page).not.toHaveURL(/step=loans/);
  await page.getByLabel(/Spending a month/).fill('38000');
  await expect(page.getByTestId('zero-spend-confirm')).toHaveCount(0);
  await page.getByRole('button', { name: /CONTINUE · WHAT YOU OWE/ }).click();
  await expect(page).toHaveURL(/step=loans/);

  // B-10: Back goes to step 1 with the numbers still there; Forward returns.
  await fillLoan(page, 0, { kind: /^home$/i, balance: '3200000', rate: '8.5', emi: '30000' });
  await page.goBack();
  await expect(page).not.toHaveURL(/step=loans/);
  await expect(page).toHaveURL(/\/onboarding/);
  await expect(page.getByLabel(/Take-home pay a month/)).toHaveValue(/95,?000/);
  await page.goForward();
  await expect(page).toHaveURL(/step=loans/);
  // A reload keeps the step and the loan typed on it.
  await page.reload();
  await expect(page).toHaveURL(/step=loans/);
  await expect(page.getByRole('button', { name: /CONTINUE · SEE YOUR PLAN/ })).toBeVisible();
  await expect(page.getByLabel('Balance left to repay').first()).toHaveValue(/32/);
  await fillLoan(page, 1, { kind: /^car$/i, balance: '520000', rate: '9.2', emi: '14500' });
  await fillLoan(page, 2, { kind: /^card$/i, balance: '85000', rate: '42' });
  await page.getByRole('button', { name: /CONTINUE · SEE YOUR PLAN/ }).click();
  await expect(page).toHaveURL(/step=plan/);
  await planPreviewSettled(page);
  await makeSetupChoices(page);
  if (shots) await page.screenshot({ path: `${shots}/after-ux50-setup3-1366.png`, fullPage: true });
  await page.getByRole('button', { name: /SAVE · OPEN MY PLAN/ }).click();
  await continueToPlan(page);

  // B-02 + B-11: Home right after Setup.
  await page.goto('/');
  await expect(page.getByTestId('guest-welcome-back')).toHaveCount(0);
  const strip = page.locator('#main').getByTestId('home-this-month');
  await expect(strip).toContainText(/This month: pay ₹[\d,]+\. Every EMI and card minimum \(₹[\d,]+\), plus ₹[\d,]+ extra on your credit card/);

  // B-01: the extra's row is tagged, numbered as in "Your loans and cards" (03).
  const extraRow = page.locator('#main li[data-extra="here"]');
  await expect(extraRow).toHaveCount(1);
  await expect(extraRow.getByTestId('extra-tag')).toHaveText('· EXTRA GOES HERE');
  await expect(extraRow.locator('span').first()).toHaveText('03');
  if (shots) await page.screenshot({ path: `${shots}/after-ux50-home-1366.png`, fullPage: true });

  // B-12: mark the card paid; its balance and the total move.
  await page.getByRole('button', { name: /^Mark paid: Credit card/ }).first().click();
  await page.getByRole('button', { name: 'SAVE' }).click();
  await expect(page.locator('#main li[data-extra="paid"]').getByTestId('extra-tag')).toHaveText('· EXTRA PAID');
  await expect(page.locator('#main').getByTestId('card-paid-down')).toContainText('WAS ₹85,000');
  if (shots) await page.screenshot({ path: `${shots}/after-ux50-home-paid-1366.png`, fullPage: true });
});
