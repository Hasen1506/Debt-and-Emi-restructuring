/**
 * Screen-level check for the meaning bugs a first-run borrower hits before
 * choosing a monthly total for debts. Uses the plain Playwright test so the
 * suite's "all spare cash" cookie is not set: that cookie hid the state.
 */
import { test as base, expect, type Page } from '@playwright/test';
import { confirmAgeAndSend, fillLoan, makeSetupChoices, OTP } from './fixtures';

const test = base;

async function signInFresh(page: Page, email: string) {
  await page.goto('/login');
  await page.getByPlaceholder('you@example.com').fill(email);
  await confirmAgeAndSend(page);
  await expect(page.getByText(`We sent a 6-digit code to ${email}`)).toBeVisible();
  await page.getByLabel(/6-digit code/i).fill(OTP);
  await page.getByRole('button', { name: /verify and sign in/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
}

test('unset debt total: spare cash, spending and pay-this-month agree', async ({ page }) => {
  const email = `ux-meaning-${Date.now()}@rightdue.app`;
  await signInFresh(page, email);
  await expect(page).toHaveURL(/\/onboarding/);
  await page.getByLabel(/Take-home pay a month|What reaches your bank/i).first().fill('80000');
  await page.getByLabel(/Spending a month/i).fill('30000');
  await page.getByRole('button', { name: /CONTINUE · WHAT YOU OWE/ }).click();
  await fillLoan(page, 0, { kind: /^Home$/, balance: '2500000', rate: '8.5', emi: '21696', emiGoneOut: 'due' });
  await page.getByRole('button', { name: /CONTINUE · SEE YOUR PLAN/ }).click();
  await makeSetupChoices(page);
  await page.getByRole('button', { name: /SAVE · OPEN MY PLAN/ }).click();
  await page.waitForURL((u) => u.pathname === '/');

  const month = page.getByTestId('home-this-month');
  await expect(month).toBeVisible({ timeout: 30000 });
  await expect(month).toContainText('₹21,696');
  await expect(month).toContainText('₹28,304 is spare after the amount due and is not added on top');
  await expect(month).not.toContainText('Nothing is left over');

  const body = page.locator('#main');
  await expect(body.getByText('Spending ₹30,000 + EMIs and card minimums ₹21,696')).toBeVisible();
  await expect(body.getByText(/This ₹28,304 is spare after the amount due/)).toBeVisible();
  await expect(body.getByText(/does not add it on top/)).toBeVisible();
  await expect(body.getByText('₹50,000 = take-home ₹80,000 − spending ₹30,000')).toBeVisible();
  await expect(body.getByText(/− costs ₹/)).toHaveCount(0);
  await expect(page.getByTestId('pay-left-over')).toContainText('₹28,304 is spare after the EMIs and minimums');
  await expect(page.getByTestId('pay-left-over')).not.toContainText('safe return');
  await expect(body.getByText('₹17,708/MO')).toBeVisible();

  // Mark the only payment. The paid note has to appear; seeded data used to
  // stop one payment short of it.
  await page.getByRole('button', { name: /Mark paid/i }).click();
  await page.getByRole('button', { name: 'SAVE' }).click();
  await expect(month).toContainText(/all paid/i);
});

test('what-if rate box keeps a typed basis-point amount', async ({ page }) => {
  const email = `ux-bps-${Date.now()}@rightdue.app`;
  await signInFresh(page, email);
  await page.getByLabel(/Take-home pay a month|What reaches your bank/i).first().fill('80000');
  await page.getByLabel(/Spending a month/i).fill('30000');
  await page.getByRole('button', { name: /CONTINUE · WHAT YOU OWE/ }).click();
  await fillLoan(page, 0, { kind: /^Home$/, balance: '2500000', rate: '8.5', emi: '21696', emiGoneOut: 'due' });
  await page.getByRole('button', { name: /CONTINUE · SEE YOUR PLAN/ }).click();
  await makeSetupChoices(page);
  await page.getByRole('button', { name: /SAVE · OPEN MY PLAN/ }).click();
  await page.waitForURL((u) => u.pathname === '/');
  await page.goto('/plan');
  const box = page.getByLabel('If floating rates change, basis points');
  await expect(box).toBeEnabled({ timeout: 30000 });
  await box.fill('30');
  await box.blur();
  await expect(box).toHaveValue('30');
  await expect(page.getByTestId('whatif-box-error')).toHaveCount(0);
});

test('a minus amount is named, even after Continue said the field was empty', async ({ page }) => {
  const email = `ux-neg-${Date.now()}@rightdue.app`;
  await signInFresh(page, email);
  await expect(page).toHaveURL(/\/onboarding/);
  await page.getByRole('button', { name: /CONTINUE · WHAT YOU OWE/ }).click();
  await expect(page.getByText(/Enter what reaches your bank/i)).toBeVisible();
  const take = page.getByLabel(/Take-home pay a month|What reaches your bank/i).first();
  await take.fill('-100');
  await page.getByLabel(/Spending a month/i).fill('-5');
  await expect(page.getByRole('alert').filter({ hasText: /Amounts can't be negative/i }).first()).toBeVisible();
  await expect(take).toHaveValue('-100');
});
