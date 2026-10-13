/**
 * Live re-test 6B fix round (R6B):
 *  - Setup step 1 warns when spending is above take-home;
 *  - R6B-7: an out-of-range APR is marked before Continue, and the summary
 *    says "out of range", not "isn't a valid number";
 *  - R6B-6: the 404 has its own title;
 *  - R6B-9: picking a payoff order offline keeps the page, saves the
 *    choice, says so, and redraws once back online.
 */
import { expect, fillLoan, makeSetupChoices, signIn, test } from './fixtures';

test('R6B: step-1 overspend warning, out-of-range APR, 404 title, strategy offline', async ({ page, context }) => {
  await signIn(page, 'golden-r6b@rightdue.app');
  await expect(page).toHaveURL(/\/onboarding$/);

  // Step 1: spending above take-home is flagged where both numbers are.
  await page.getByLabel(/Take-home pay a month/).fill('50000');
  await page.getByLabel(/Spending a month/).fill('80000');
  await expect(page.getByTestId('spend-over-income')).toContainText('a month more than you take home');
  await page.getByLabel(/Spending a month/).fill('30000');
  await expect(page.getByTestId('spend-over-income')).toHaveCount(0);
  await page.getByLabel(/Take-home pay a month/).fill('95000');
  await page.getByRole('button', { name: /CONTINUE · WHAT YOU OWE/ }).click();
  await expect(page).toHaveURL(/step=loans/);

  // R6B-7: −42% is marked as soon as it's left, before Continue.
  await fillLoan(page, 0, { kind: /^home$/i, balance: '2500000', rate: '-42', emi: '22000' });
  const rate = page.getByLabel('Interest rate, % a year').first();
  await rate.blur();
  await expect(rate).toHaveAttribute('aria-invalid', 'true');
  await page.getByRole('button', { name: /CONTINUE · SEE YOUR PLAN/ }).click();
  await expect(page.getByText(/its rate is out of range/)).toBeVisible();
  await expect(page.getByText(/its rate isn’t a valid number/)).toHaveCount(0);
  await rate.fill('8.6');
  await expect(rate).not.toHaveAttribute('aria-invalid', 'true');
  await page.getByRole('button', { name: /CONTINUE · SEE YOUR PLAN/ }).click();
  await expect(page).toHaveURL(/step=plan/);
  await makeSetupChoices(page);
  await page.getByRole('button', { name: /SAVE · OPEN MY PLAN/ }).click();
  await page.waitForURL('**/plan');

  // R6B-9: offline, a new order is saved and noted; the page stays put.
  const first = page.locator('button[aria-label^="Switch to"][aria-pressed="false"]').first();
  await expect(first).toBeVisible();
  const label = (await first.getAttribute('aria-label')) as string;
  const sw = page.getByRole('button', { name: label, exact: true });
  // Let /plan finish loading first (Firefox: a click going offline mid-load
  // waits on that navigation forever).
  await page.waitForLoadState('networkidle');
  await expect(page.getByText('Working out your plan…')).toHaveCount(0);
  await context.setOffline(true);
  await sw.click();
  await expect(page.getByTestId('strategy-offline-note').first()).toBeVisible();
  await expect(page).toHaveURL(/\/plan$/);
  await expect(page.locator('#main')).toHaveCount(1);
  await expect(sw).toHaveAttribute('aria-pressed', 'true');
  await context.setOffline(false);
  await expect(page.getByTestId('strategy-offline-note')).toHaveCount(0);
  await expect(page).toHaveURL(/\/plan$/);

  // R6B-6: Home and the 404 have their own titles.
  await page.goto('/');
  await expect(page).toHaveTitle('Home · RightDue');
  await page.goto('/no-such-page-r6b');
  await expect(page).toHaveTitle('Page not found · RightDue');
});
