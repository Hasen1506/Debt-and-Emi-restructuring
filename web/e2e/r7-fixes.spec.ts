/**
 * Live re-test 7 (14 Oct 2026) fixes, end to end.
 *  - R7-4: printing the Plan leaves out the nav, buttons, action cards and
 *    what-if controls, and keeps the figures and the month-by-month table.
 *  - R7-5: Sell to repay checks its loan rate as it's typed (0–100% a year),
 *    never "Must be 10 or less." on a % field.
 *  - R7-6: New debt's credit score is a whole number from 300 to 900.
 *  - R7-7: a US borrower's Setup says "monthly payment", not EMI, and offers
 *    no gold loan.
 */
import { expect, fillLoan, makeSetupChoices, signIn, test } from './fixtures';

test('R7-4/R7-5/R7-6: print view, Sell to repay rate, New debt score', async ({ page }) => {
  await signIn(page, 'golden-r7-fixes@rightdue.app');
  await expect(page).toHaveURL(/\/onboarding$/);
  await page.getByLabel(/Take-home pay a month/).fill('95000');
  await page.getByLabel(/Spending a month/).fill('41000');
  await page.getByRole('button', { name: /CONTINUE · WHAT YOU OWE/ }).click();
  await fillLoan(page, 0, { kind: /^card$/i, balance: '180000', rate: '39' });
  await fillLoan(page, 1, { kind: /^personal$/i, balance: '60000', rate: '13', emi: '5200' });
  await page.getByRole('button', { name: /CONTINUE · SEE YOUR PLAN/ }).click();
  await makeSetupChoices(page);
  await page.getByRole('button', { name: /SAVE · OPEN MY PLAN/ }).click();
  await page.waitForURL('**/plan');
  const main = page.locator('#main');
  await expect(main.locator('table').first()).toBeAttached();

  // R7-4: on screen the page has its buttons; in print it has none.
  expect(await main.getByRole('button').count()).toBeGreaterThan(0);
  await page.emulateMedia({ media: 'print' });
  const shown = await page.evaluate(() => {
    const visible = (el: Element) => {
      const r = (el as HTMLElement).getBoundingClientRect();
      return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
    };
    const sel = 'header, nav, button, [role="button"], [role="menu"], select, input, textarea, #what-if, #tenure-what-if, [data-print="hide"]';
    return {
      chrome: Array.from(document.querySelectorAll(sel)).filter(visible).map((el) => `${el.tagName.toLowerCase()} ${(el.textContent || '').trim().slice(0, 40)}`),
      tables: Array.from(document.querySelectorAll('#main table')).filter(visible).length,
      text: (document.querySelector('#main') as HTMLElement | null)?.innerText ?? '',
    };
  });
  expect(shown.chrome, 'app chrome still printed').toEqual([]);
  expect(shown.tables, 'the month-by-month table prints').toBeGreaterThan(0);
  expect(shown.text).toMatch(/DEBT-FREE/);
  expect(shown.text).toMatch(/MONTH BY MONTH/);
  await page.emulateMedia({ media: 'screen' });
  await expect(main.getByRole('button').first()).toBeVisible();

  // R7-5: Sell to repay's loan rate is checked as it's typed.
  await page.goto('/tools/liquidate');
  const rate = page.getByLabel('Its rate (%)');
  await expect(rate).toBeVisible();
  await rate.fill('99999999999999');
  await expect(rate).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByText(/Rates above 100% a year aren’t accepted/).first()).toBeVisible();
  await expect(page.getByText('Must be 10 or less.')).toHaveCount(0);
  await rate.fill('-5000');
  await expect(rate).toHaveAttribute('aria-invalid', 'true');
  await rate.fill('12');
  await expect(rate).not.toHaveAttribute('aria-invalid', 'true');

  // R7-6: New debt's credit score.
  await page.goto('/tools/new-debt');
  const score = page.getByLabel('Credit score (optional)');
  await expect(score).toBeVisible();
  for (const bad of ['abc', '-5000', '1e9', '99999999999999', '5L', '950']) {
    await score.fill(bad);
    await expect(score, bad).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByText('Enter a score from 300 to 900 (CIBIL/Experian/CRIF), a whole number.').first()).toBeVisible();
  }
  await score.fill('760');
  await expect(score).not.toHaveAttribute('aria-invalid', 'true');
  await score.fill('');
  await expect(score).not.toHaveAttribute('aria-invalid', 'true');
});

test('R7-7: US Setup says monthly payment, not EMI, and has no gold loan', async ({ page }) => {
  await signIn(page, 'golden-r7-us@rightdue.app');
  await expect(page).toHaveURL(/\/onboarding$/);
  await page.getByRole('group', { name: 'Where you live' }).getByRole('button', { name: /USA/ }).click();
  // R3C-1: Setup asks how a US filer files (no silent Single).
  await page.getByRole('group', { name: 'How you file your tax return' }).getByRole('button', { name: /^Single$/ }).click();
  await expect(page.getByLabel('Spending a month, without monthly payments')).toBeVisible();
  await page.getByLabel(/Take-home pay a month/).fill('6500');
  await page.getByLabel(/Spending a month/).fill('3800');
  await expect(page.locator('#main')).not.toContainText(/\bEMIs?\b/);
  await page.getByRole('button', { name: /CONTINUE · WHAT YOU OWE/ }).click();
  await expect(page).toHaveURL(/step=loans/);
  const kinds = page.getByRole('group', { name: 'Kind of loan' }).first();
  await expect(kinds.getByRole('button', { name: /^car$/i })).toBeVisible();
  await expect(kinds.getByRole('button', { name: /^gold$/i })).toHaveCount(0);
  await fillLoan(page, 0, { kind: /^card$/i, balance: '9000', rate: '24' });
  await fillLoan(page, 1, { kind: /^car$/i, balance: '18000', rate: '7', emi: '420' });
  await expect(page.getByRole('textbox', { name: 'Monthly payment' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'EMI a month' })).toHaveCount(0);
  await page.getByRole('button', { name: /CONTINUE · SEE YOUR PLAN/ }).click();
  await expect(page).toHaveURL(/step=plan/);
  // Audit 80 (W6) US wording: "Make every payment and card minimum".
  await expect(page.getByText(/Make every payment and card minimum/).first()).toBeVisible();
  await expect(page.getByText(/Pay every EMI/)).toHaveCount(0);
});
