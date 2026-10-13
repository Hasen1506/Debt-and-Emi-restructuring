/**
 * Sprint L4: "I can't pay this month" triage, from Home's soft view.
 * A Chennai borrower whose take-home minus spending (₹50,000) can't cover
 * a ₹35,000 home EMI, a ₹15,000 car EMI and a card minimum: the page keeps
 * the home and car loans whole and shows the card minimum as short.
 */
import type { Page } from '@playwright/test';
import { expect, fillLoan, signIn, test, makeSetupChoices } from './fixtures';

const AXE = require.resolve('axe-core/axe.min.js');

/** axe's critical violations on the page as it is now (UX50: Can't pay had 5 unnamed inputs, Activity bad grid rows). */
export async function axeCritical(page: Page): Promise<string[]> {
  await page.addScriptTag({ path: AXE });
  const v = (await page.evaluate(async () => {
    const r = await (window as unknown as { axe: { run: (c: unknown, o: unknown) => Promise<{ violations: unknown[] }> } }).axe.run(document, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
    });
    return r.violations;
  })) as Array<{ id: string; impact: string | null; nodes: { target: string[] }[] }>;
  return v.filter((x) => x.impact === 'critical').map((x) => `${x.id}: ${x.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`);
}

test('India: Feeling overwhelmed → can\u2019t pay this month → protect order, cost, letter, rights', async ({ page }) => {
  await signIn(page, 'golden-cantpay@rightdue.app');
  await page.getByLabel(/Take-home pay a month/).fill('90000');
  await page.getByLabel(/Spending a month/).fill('40000');
  await page.getByRole('button', { name: /CONTINUE · WHAT YOU OWE/ }).click();
  await fillLoan(page, 0, { kind: /^home$/i, balance: '3500000', rate: '8.5', emi: '35000' });
  await fillLoan(page, 1, { kind: /^car$/i, balance: '500000', rate: '9', emi: '15000' });
  await fillLoan(page, 2, { kind: /^card$/i, balance: '85000', rate: '42' });
  await page.getByRole('button', { name: /CONTINUE · SEE YOUR PLAN/ }).click();
  await makeSetupChoices(page);
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
  const letter = page.getByLabel(/The letter \(you can edit it here\)/);
  await expect(letter).toHaveValue(/^DRAFT/);
  await expect(page.getByTestId('cp-rights')).toContainText('before 8:00 a.m. or after 7:00 p.m.');
  await expect(page.getByTestId('cp-settle')).toContainText('at least 12 months');
  await expect(page.getByRole('link', { name: /LONGER TENURE WHAT-IF/ })).toHaveAttribute('href', '/plan#tenure-what-if');
});

test('UX50 F3: Can\u2019t pay fields are named, months are bounded, the letter is editable and leaves the page; axe has no critical issues', async ({ page, context, browserName }) => {
  await signIn(page, 'ux50-cantpay@rightdue.app');
  await page.getByLabel(/Take-home pay a month/).fill('90000');
  await page.getByLabel(/Spending a month/).fill('40000');
  await page.getByRole('button', { name: /CONTINUE · WHAT YOU OWE/ }).click();
  await fillLoan(page, 0, { kind: /^home$/i, balance: '3500000', rate: '8.5', emi: '35000' });
  await fillLoan(page, 1, { kind: /^personal$/i, balance: '400000', rate: '14', emi: '20000' });
  await page.getByRole('button', { name: /CONTINUE · SEE YOUR PLAN/ }).click();
  await makeSetupChoices(page);
  await page.getByRole('button', { name: /SAVE · OPEN MY PLAN/ }).click();
  await page.waitForURL('**/plan');
  await page.goto('/cant-pay');
  await expect(page).toHaveTitle(/Can.t pay this month · RightDue/);
  const tb = (n: string | RegExp) => page.getByRole('textbox', { name: n, exact: typeof n === 'string' });

  // C-01: every field has a name; C-06: the amount shows Indian grouping.
  const money = tb('Money you have for loan payments this month');
  await expect(money).toHaveValue('50,000');
  await expect(money).toHaveAttribute('inputmode', 'decimal');
  for (const name of ['Months unpaid', /Penal charge/, 'Bounce / NACH return charge', 'Lender', 'Your name', 'Reason (short and true)', 'You can pay a month', 'Loan account number']) {
    await expect(tb(name)).toBeVisible();
  }
  expect(await axeCritical(page), 'axe critical on /cant-pay').toEqual([]);

  // C-07: both pickers start on the loan that is short this month.
  await expect(page.getByRole('combobox', { name: 'Loan to check' })).toHaveValue(await page.getByRole('combobox', { name: 'Loan for the letter' }).inputValue());
  await expect(page.getByRole('combobox', { name: 'Loan to check' }).locator('option:checked')).toHaveText(/Personal loan/);

  // R5-1: months bounded; a huge number names the field instead of a 16-digit figure.
  const months = tb('Months unpaid');
  await months.fill('9999999999999');
  await expect(page.getByText(/Up to 24 months/)).toBeVisible();
  await expect(months).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByTestId('cp-cost-total')).toContainText('Fix the field above');
  await expect(page.getByTestId('cp-cost-total')).not.toContainText(/\d{8,}/);
  // O-3: 3 months = 3 overdue EMIs; ₹20,000 × 14%/12 × 6 = ₹1,400.
  await months.fill('3');
  await expect(page.getByTestId('cp-cost-total')).toContainText('3 unpaid instalments of ₹20,000');
  await expect(page.getByTestId('cp-cost-total')).toContainText('₹1,400');

  // C-05/C-06: can-pay prefilled from section 1 (₹15,000 of the ₹20,000 EMI), letter filled and editable.
  await expect(tb('You can pay a month')).toHaveValue('15,000');
  await tb('Lender').fill('Axis Bank');
  await tb('Your name').fill('Meena R');
  const letter = page.getByLabel(/The letter \(you can edit it here\)/);
  await expect(letter).toHaveValue(/To: Axis Bank/);
  await expect(letter).toHaveValue(/I can pay ₹15,000 a month/);
  await expect(letter).toHaveValue(/Meena R$/);
  await letter.fill('My own words.');
  await expect(page.getByRole('button', { name: /RESET TO DRAFT/ })).toBeVisible();
  await page.getByRole('button', { name: /RESET TO DRAFT/ }).click();
  await expect(letter).toHaveValue(/^DRAFT/);
  await expect(page.getByRole('link', { name: /EMAIL IT/ })).toHaveAttribute('href', /^mailto:\?subject=Request%20for%20hardship%20relief/);
  if (browserName === 'chromium') await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.getByRole('button', { name: /COPY LETTER/ }).click();
  await expect(page.getByTestId('cp-letter-said')).toContainText(/copied|copy it by hand/);
  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: /DOWNLOAD .TXT/ }).click();
  expect((await dl).suggestedFilename()).toBe('hardship-letter.txt');
  await page.screenshot({ path: `${process.env.F3_SHOTS ?? 'test-results'}/cant-pay-after-${browserName}.png`, fullPage: true });

  // UX50 O-2: retyping the picked loan's own rate keeps it named in the answer.
  await page.goto('/tools/invest-vs-prepay');
  await expect(page).toHaveTitle(/Invest or prepay · RightDue/);
  const rate = page.getByLabel(/The loan's rate, a year/);
  const before = await rate.inputValue();
  const verdict = page.locator('main');
  await expect(verdict).toContainText(/personal loan/i);
  await rate.fill('');
  await rate.fill(before);
  await expect(page.getByText(/the loan\./)).toHaveCount(0);
  await expect(page.getByRole('button', { name: new RegExp(`Personal loan · ${before.replace('.', '\\.')}%`) })).toHaveAttribute('aria-pressed', 'true');

  // C-08 + phone layout: axe on Can't pay and Activity at 390 (Activity's
  // narrow rows held buttons straight inside role=row).
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/cant-pay');
  await expect(tb('Months unpaid')).toBeVisible();
  // C-02: 16px on a phone so iOS doesn't zoom.
  expect(await tb('Months unpaid').evaluate((el) => getComputedStyle(el).fontSize)).toBe('16px');
  expect(await axeCritical(page), 'axe critical on /cant-pay at 390').toEqual([]);
  await page.goto('/activity');
  await expect(page.locator('[role="row"]').first()).toBeVisible();
  expect(await axeCritical(page), 'axe critical on /activity at 390').toEqual([]);
  await page.screenshot({ path: `${process.env.F3_SHOTS ?? 'test-results'}/activity-after-390-${browserName}.png`, fullPage: true });
});

