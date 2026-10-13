/**
 * Sprint G10 (product surface): the landing's country toggle, the choices
 * setup no longer makes silently, Portfolio as its own tab, and Sell to
 * repay as a plain calculator (no ranking, no verdict).
 */
import { expect, fillLoan, signIn, test } from './fixtures';

test.describe('landing: senses the country and lets the visitor switch', () => {
  test.use({ locale: 'en-US', extraHTTPHeaders: { 'Accept-Language': 'en-US,en;q=0.9' } });

  test('a US browser opens on the US example; the toggle switches and is kept', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('data-country', 'US');
    await expect(page.getByRole('button', { name: /USA · \$/ })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByText('$279,000').first()).toBeVisible();
    await expect(page.getByText('₹47,30,000').first()).toBeHidden();

    await page.getByRole('button', { name: /INDIA · ₹/ }).click();
    await expect(page.locator('html')).toHaveAttribute('data-country', 'IN');
    await expect(page.getByText('₹47,30,000').first()).toBeVisible();
    await expect(page.getByText('$279,000').first()).toBeHidden();
    // The honest baseline: the same budget, smallest first.
    await expect(page.getByText('VS SMALLEST FIRST, SAME ₹90,000').first()).toBeVisible();

    // The visitor's own pick beats the sensed country on the next visit.
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-country', 'IN');
  });
});

test('setup asks the choices, Portfolio has its own tab, Sell to repay is a calculator', async ({ page }) => {
  await test.step('sign in and set up one loan', async () => {
    await signIn(page, 'g10-surface@rightdue.app');
    await expect(page).toHaveURL(/\/onboarding$/);
    await page.getByLabel(/Take-home pay a month/).fill('120000');
    await page.getByLabel(/Spending a month/).fill('40000');
    await page.getByRole('button', { name: /CONTINUE · WHAT YOU OWE/ }).click();
    await fillLoan(page, 0, { kind: /^personal$/i, balance: '400000', rate: '13', emi: '12000' });
    await page.getByRole('button', { name: /CONTINUE · SEE YOUR PLAN/ }).click();
  });

  await test.step('saving without the choices asks for them', async () => {
    await expect(page.getByRole('heading', { name: /CHOICES ONLY YOU CAN MAKE/ })).toBeVisible();
    await page.getByRole('button', { name: /SAVE · OPEN MY PLAN/ }).click();
    await expect(page.getByText('Pick how many months of spending to keep aside, or Not now.')).toBeVisible();
    await expect(page.getByText('Pick the order your loans are paid off in.')).toBeVisible();
    await expect(page).toHaveURL(/\/onboarding/);
  });

  await test.step('pick them: 6 months, 30%, cheapest path', async () => {
    await page.getByRole('button', { name: /^6 months/ }).click();
    await page.getByRole('button', { name: /^30%, the rest to loans/ }).click();
    await page.getByRole('button', { name: /^Cheapest path \(Avalanche\)/ }).click();
    await page.getByRole('button', { name: /SAVE · OPEN MY PLAN/ }).click();
    await page.waitForURL('**/plan');
    // A plan shows after one loan, with a way to add the next.
    await expect(page.getByRole('link', { name: /Add another loan to the plan/ }).first()).toBeVisible();
  });

  await test.step('Portfolio is its own tab', async () => {
    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: '[PORTFOLIO]' }).click();
    await page.waitForURL('**/portfolio');
    await expect(page.getByText(/What you hold and what it’s worth/)).toBeVisible();
  });

  await test.step('Sell to repay works out a sale the person picks', async () => {
    await page.goto('/tools/liquidate');
    await page.getByRole('button', { name: 'Gold', exact: true }).click();
    await page.getByLabel('What you paid').fill('200000');
    await page.getByLabel('When you bought it').fill('2019');
    await page.getByLabel('What it would sell for').fill('450000');
    const pick = page.getByRole('button', { name: /^Personal loan/ });
    if (await pick.count()) await pick.first().click();
    else {
      await page.getByLabel('Still owed').fill('400000');
      await page.getByLabel('Its rate (%)').fill('13');
    }
    await page.getByRole('button', { name: /Work it out/i }).click();
    await expect(page.getByText('What these numbers leave out')).toBeVisible();
    await expect(page.getByText('YOU GET', { exact: true })).toBeVisible();
    const out = await page.locator('main').innerText();
    expect(out).not.toMatch(/\bsell it and\b|\brecommended\b|\bbest (asset|holding) to sell\b/i);
  });
});
