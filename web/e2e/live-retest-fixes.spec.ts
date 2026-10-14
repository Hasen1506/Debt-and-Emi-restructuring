/**
 * Live re-test, 13 Oct 2026 (LIVE-RETEST-2026-10-13.md):
 *  - NEW-1: typing "25 la" one key at a time, or typing into a filled
 *    amount field, crashed setup with "Application error" (DecimalError).
 *  - NEW-3/NEW-4: a home loan whose EMI is below its monthly interest
 *    (₹2.5 crore at 8.6%, EMI ₹22,000) was accepted; it is now blocked with
 *    the numbers and a "did you mean ₹25 lakh?" check.
 */
import { expect, loanBlocks, signIn, test } from './fixtures';
import { isWebKitNavigationNoise } from './browser-noise';

const EMAIL = 'golden-live-retest@rightdue.app';

test('amount fields never crash setup, and an EMI below the interest is blocked', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => { if (!isWebKitNavigationNoise(e.message)) errors.push(String(e)); });
  await signIn(page, EMAIL);
  await expect(page).toHaveURL(/\/onboarding$/);
  await page.getByLabel(/Take-home pay a month/).fill('120000');
  await page.getByLabel(/Spending a month/).fill('50000');
  await page.getByRole('button', { name: /CONTINUE · WHAT YOU OWE/ }).click();
  const b = loanBlocks(page).nth(0);
  await b.getByRole('button', { name: /^home$/i }).click();
  await b.getByLabel('Interest rate, % a year').fill('8.6');
  await b.getByLabel('EMI a month').fill('22000');

  await test.step('NEW-1: "25 lakh" typed one key at a time', async () => {
    const bal = b.getByLabel('Balance left to repay');
    await bal.click();
    await bal.pressSequentially('25 lakh', { delay: 30 });
    await expect(page.getByText(/Application error/)).toHaveCount(0);
    await expect(bal).toHaveValue(/25 ?lakh|25,00,000/);
    await expect(b.getByText('= ₹25 lakh')).toBeVisible();
  });

  await test.step('NEW-1: typing into a filled field', async () => {
    const bal = b.getByLabel('Balance left to repay');
    await bal.fill('2500000');
    await bal.blur();
    await bal.click();
    await bal.press('End');
    await bal.pressSequentially('25,00,000', { delay: 20 });
    await expect(page.getByText(/Application error/)).toHaveCount(0);
    await bal.fill('');
    await bal.pressSequentially('25 la', { delay: 30 });
    await expect(page.getByText(/Application error/)).toHaveCount(0);
    await expect(bal).toHaveValue('25 la');
  });

  await test.step('NEW-3/NEW-4: ₹2.5 crore at 8.6% with a ₹22,000 EMI is blocked', async () => {
    const bal = b.getByLabel('Balance left to repay');
    await bal.fill('25000000');
    await expect(b.getByText(/earns ₹1,79,167 interest a month, more than the ₹22,000 EMI/)).toBeVisible();
    await expect(b.getByText(/did you mean ₹25 lakh\?/)).toBeVisible();
    await page.getByRole('button', { name: /CONTINUE · SEE YOUR PLAN/ }).click();
    await expect(page).toHaveURL(/\/onboarding/);
    await expect(b.getByText(/would never be paid off/).first()).toBeVisible();
    // Corrected, it goes through.
    await bal.fill('2500000');
    await expect(b.getByText(/would never be paid off/)).toHaveCount(0);
    await expect(b.getByText(/About \d+ months left/)).toBeVisible();
  });

  expect(errors.filter((e) => /DecimalError/.test(e))).toEqual([]);
});
