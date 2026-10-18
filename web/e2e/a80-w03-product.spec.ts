/**
 * Audit 80+ W3 (product findings) at 390 px: A1 "where we disagree, worth ₹X",
 * A2 order asked only when it matters, A5 the gap as the headline when short,
 * A6 the cheaper-way card, A4 prepay/keep/split on Plan, and "Don't sign
 * that" on Home. Each card must fit a 390 px phone (no sideways scroll).
 * Unit-level renders of the same cards: web/tests/a80-w03-product.cjs.
 */
import type { Page } from '@playwright/test';
import { expect, fillLoan, makeSetupChoices, signIn, test } from './fixtures';

test.use({ viewport: { width: 390, height: 844 } });

async function fitsThePhone(page: Page, testId: string) {
  const el = page.getByTestId(testId).first();
  await expect(el).toBeVisible();
  const box = await el.boundingBox();
  expect(box, testId).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390 + 0.5);
  const sideways = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(sideways, `${testId}: page scrolls sideways`).toBeLessThanOrEqual(0);
}

test('A5 at 390: short this month, the gap is the headline on Setup and Home', async ({ page }) => {
  await signIn(page, 'golden-a80-w03-short@rightdue.app');
  await page.getByLabel(/Take-home pay a month/).fill('70000');
  await page.getByLabel(/Spending a month/).fill('30000');
  await page.getByRole('button', { name: /CONTINUE · WHAT YOU OWE/ }).click();
  await fillLoan(page, 0, { kind: /^personal$/i, balance: '400000', rate: '14', emi: '52661' });
  await fillLoan(page, 1, { kind: /^home$/i, balance: '2500000', rate: '8.6', emi: '21854' });
  await page.getByRole('button', { name: /CONTINUE · SEE YOUR PLAN/ }).click();

  // UI revert 18 Oct 2026: Setup step 3 is the 4bc3dc8 layout (no insight
  // cards): the short alert and the gap as the big figure, not a date.
  await expect(page.getByRole('alert').filter({ hasText: /₹34,515 a month short/ }).first()).toBeVisible();
  await expect(page.getByText(/^₹34,515\/mo short$/).first()).toBeVisible();
  await expect(page.getByTestId('gap-headline')).toHaveCount(0);

  await makeSetupChoices(page);
  await page.getByRole('button', { name: /SAVE · OPEN MY PLAN/ }).click();
  await page.waitForURL('**/plan');
  await expect(page.locator('#main').getByText('₹34,515/MO SHORT').first()).toBeVisible();

  await page.goto('/');
  const main = page.locator('#main');
  await expect(main.getByText('₹34,515/MO SHORT').first()).toBeVisible();
  // The gap card lives on Home.
  await fitsThePhone(page, 'gap-headline');
  await expect(page.getByTestId('gap-amount').first()).toHaveText('₹34,515');
  // No card here, so no "move the card" way: a longer tenure on the biggest
  // stretchable EMI, then spend less / earn more (engine gap_ways, up to 3).
  const gapCard = page.getByTestId('gap-headline').first();
  await expect(gapCard.locator('li')).toHaveCount(2);
  await expect(gapCard.getByTestId('gap-way-stretch')).toBeVisible();
  await expect(gapCard.getByTestId('gap-way-spend')).toBeVisible();
  await expect(page.getByTestId('gap-conditional-date').first()).toBeVisible();
});

test('A1 A2 A6 A4 + offer check at 390: the persona', async ({ page }) => {
  await test.step('Setup step 3: 4bc3dc8 layout (no cards), order not asked', async () => {
    await signIn(page, 'golden-a80-w03-persona@rightdue.app');
    await page.getByLabel(/Take-home pay a month/).fill('120000');
    await page.getByLabel(/Spending a month/).fill('40000');
    await page.getByRole('button', { name: /CONTINUE · WHAT YOU OWE/ }).click();
    await fillLoan(page, 0, { kind: /^card$/i, balance: '150000', rate: '42' });
    await fillLoan(page, 1, { kind: /^personal$/i, balance: '400000', rate: '14', emi: '10931' });
    // R2-3 moved the prepay/keep/split trigger to the assumed 6.5% return + 1 point
    // (7.5%), so the home loan left at the end is a 7.2% one (8.6% never asks).
    await fillLoan(page, 2, { kind: /^home$/i, balance: '2500000', rate: '7.2', emi: '21855' });
    await page.getByRole('button', { name: /CONTINUE · SEE YOUR PLAN/ }).click();
    // UI revert: the insight cards are on Home, not Setup.
    await fitsThePhone(page, 'setup-this-month');
    await expect(page.getByTestId('disagree-card')).toHaveCount(0);
    await expect(page.getByTestId('cheaper-way')).toHaveCount(0);
    // A2: all orders give the same result for these loans, so it isn't asked.
    await fitsThePhone(page, 'order-same');
    await expect(page.getByTestId('order-ask')).toHaveCount(0);
    await makeSetupChoices(page);
    await page.getByRole('button', { name: /SAVE · OPEN MY PLAN/ }).click();
    await page.waitForURL('**/plan');
  });

  await test.step('Plan: prepay, keep or split once only the 7.2% home loan is left', async () => {
    await fitsThePhone(page, 'prepay-keep-split');
    await expect(page.getByTestId('pks-statement')).not.toContainText(/fund|equity|stock|Nifty|S&P/i);
    await expect(page.getByTestId('pks-row-0')).toBeVisible();
    await expect(page.getByTestId('pks-row-1')).toBeVisible();
  });

  await test.step('Home: the cards come first; the offer check opens and fits', async () => {
    await page.goto('/');
    await fitsThePhone(page, 'disagree-card');
    await expect(page.getByTestId('disagree-total').first()).toHaveText(/^₹[\d,]+$/);
    await fitsThePhone(page, 'cheaper-way');
    await expect(page.getByTestId('cheaper-neutral').first()).toHaveText("We don't arrange loans and no lender pays us.");
    await page.getByText(/CHECK IT BEFORE YOU SIGN/).click();
    await fitsThePhone(page, 'offer-check');
  });
});
