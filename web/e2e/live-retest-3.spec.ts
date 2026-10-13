/**
 * Live re-test 3, 13 Oct 2026 (LIVE-RETEST-3-2026-10-13.md):
 *  - R3-1: after a what-if in a short month that never clears, the chart's
 *    screen-reader summary still says the minimums never clear.
 *  - R3-4: an unreadable rate in Setup is "not a valid number", not missing.
 *  - R3-2: New Debt Check: 0 or 6016 months gets a field error as typed and
 *    no bank EMI or interest figures; a valid tenure brings them back.
 *  - R3-3 / NEW-18: Invest or prepay: "abc" and "500" get inline errors;
 *    the tax rate is pre-filled as 15.6-style one decimal, like everywhere.
 *  - R3-5: the open mobile menu is left-aligned.
 */
import { expect, fillLoan, loanBlocks, makeSetupChoices, signIn, test } from './fixtures';
import type { Page } from '@playwright/test';

const shots = process.env.FIX3_SHOTS;

async function setup(page: Page, email: string, takeHome: string) {
  await signIn(page, email);
  await expect(page).toHaveURL(/\/onboarding$/);
  await page.getByLabel(/Take-home pay a month/).fill(takeHome);
  await page.getByLabel(/Spending a month/).fill('40000');
  await page.getByRole('button', { name: /CONTINUE · WHAT YOU OWE/ }).click();
  await fillLoan(page, 0, { kind: /^card$/i, balance: '150000', rate: '42' });
  await fillLoan(page, 1, { kind: /^personal$/i, balance: '400000', rate: '14', emi: '13000' });
  await fillLoan(page, 2, { kind: /^home$/i, balance: '2500000', rate: '8.6', emi: '22000' });

  // R3-4: "8.5x" is not a valid rate, and the summary says so.
  const b = loanBlocks(page).nth(2);
  const rate = b.getByLabel('Interest rate, % a year');
  await rate.fill('8.5x');
  await expect(rate).toHaveAttribute('aria-invalid', 'true');
  await page.getByRole('button', { name: /CONTINUE · SEE YOUR PLAN/ }).click();
  await expect(page.getByText(/its rate isn’t a valid number/)).toBeVisible();
  await expect(page.getByText(/missing a number/)).toHaveCount(0);
  if (shots) await page.screenshot({ path: `${shots}/after-r3-4-setup-summary-1366.png`, fullPage: false });
  await rate.fill('8.6');
  await expect(page.getByText(/its rate isn’t a valid number/)).toHaveCount(0);

  await page.getByRole('button', { name: /CONTINUE · SEE YOUR PLAN/ }).click();
  await makeSetupChoices(page);
  await page.getByRole('button', { name: /SAVE · OPEN MY PLAN/ }).click();
  await page.waitForURL('**/plan');
}

test('R3-1: the what-if chart summary keeps "never clears"', async ({ page }) => {
  await setup(page, 'golden-retest3-short@rightdue.app', '70000');
  const main = page.locator('#main');
  const chart = main.locator('section', { has: page.getByText('TRAJECTORY · TOTAL DEBT OVER TIME') }).locator('svg[role=img]');
  const summary = async () => (await chart.getAttribute('aria-label')) ?? (await chart.locator('title').first().textContent()) ?? '';
  await expect.poll(summary).toMatch(/Paying only the minimums never clears it\./);
  await page.getByRole('button', { name: '+5 YRS' }).click();
  await expect(main.getByTestId('whatif-toggle')).toContainText(/SHOWING THE WHAT-IF · HOME LOAN \+5 YRS/);
  await expect.poll(summary).toMatch(/Paying only the minimums never clears it\./);
  expect(await summary()).not.toMatch(/minimums clears it in/);
  await page.getByRole('button', { name: '+10 YRS' }).click();
  await expect.poll(summary).toMatch(/Paying only the minimums never clears it\./);
  if (shots) await chart.screenshot({ path: `${shots}/after-r3-1-whatif-chart-1366.png` });
});

test('R3-2, R3-3, NEW-18, R3-5: tools validate as you type', async ({ page }) => {
  await setup(page, 'golden-retest3-tools@rightdue.app', '120000');

  await test.step('R3-2: New Debt Check months', async () => {
    await page.goto('/tools/new-debt');
    await expect(page).toHaveURL(/\/tools\/new-debt/);
    await page.getByLabel('How much').fill('300000');
    const months = page.getByLabel('For how many months');
    const table = page.locator('table').filter({ hasText: /EMI/ }).first();
    await months.fill('60');
    await expect(table).toContainText(/₹/);
    for (const bad of ['0', '6016', '600']) {
      await months.fill(bad);
      await expect(months).toHaveAttribute('aria-invalid', 'true');
      await expect(page.getByText(/whole number of months|too short|more than 40 years/).first()).toBeVisible();
      // No negative interest and no money columns while the months are invalid.
      await expect(page.getByText(/−₹|-₹/)).toHaveCount(0);
      await expect(table.getByText(/₹[\d,]+/)).toHaveCount(0);
      if (shots && bad === '0') await page.screenshot({ path: `${shots}/after-r3-2-newdebt-0months-1366.png` });
      if (shots && bad === '6016') await page.screenshot({ path: `${shots}/after-r3-2-newdebt-6016-1366.png` });
    }
    await months.fill('60');
    await expect(months).not.toHaveAttribute('aria-invalid', 'true');
    await expect(table).toContainText(/₹/);
  });

  await test.step('NEW-18 + R3-3: Invest or prepay', async () => {
    await page.goto('/tools/invest-vs-prepay');
    await expect(page).toHaveURL(/\/tools\/invest-vs-prepay/);
    const tax = page.getByLabel('Your tax rate (%)');
    await expect(tax).toHaveValue(/^\d+\.\d$/);
    await expect(page.getByText(/= 16\.00%/)).toHaveCount(0);
    const loanRate = page.getByLabel("The loan's rate, a year (%)");
    await loanRate.fill('abc');
    await expect(page.getByText('“abc” isn’t a valid rate. Type it like 8.5')).toBeVisible();
    await expect(loanRate).toHaveAttribute('aria-invalid', 'true');
    await loanRate.fill('500');
    await expect(page.getByText(/above 100% isn’t accepted/)).toBeVisible();
    await expect(loanRate).toHaveAttribute('aria-invalid', 'true');
    await tax.fill('abc');
    await expect(tax).toHaveAttribute('aria-invalid', 'true');
    if (shots) await page.screenshot({ path: `${shots}/after-r3-3-ivp-abc-1366.png` });
    await loanRate.fill('14');
    await tax.fill('15.6');
    await expect(loanRate).not.toHaveAttribute('aria-invalid', 'true');
    await expect(tax).not.toHaveAttribute('aria-invalid', 'true');
  });

  await test.step('R3-5: open mobile menu is left-aligned', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/plan');
    await expect(page).toHaveURL(/\/plan/);
    await page.getByRole('button', { name: /MENU/ }).click();
    const nav = page.locator('#rd-main-nav');
    await expect(nav).toBeVisible();
    const lefts = await nav.evaluate((el) => {
      const navLeft = el.getBoundingClientRect().left;
      const links = Array.from(el.querySelectorAll(':scope > a'));
      const extras = el.querySelector('.rd-mh-extras');
      return [...links, ...(extras ? [extras] : [])].map((n) => Math.round(n.getBoundingClientRect().left - navLeft));
    });
    expect(lefts.length).toBeGreaterThan(3);
    for (const l of lefts) expect(l).toBeLessThanOrEqual(2);
    if (shots) await page.screenshot({ path: `${shots}/after-r3-5-menu-open-390.png` });
  });
});
