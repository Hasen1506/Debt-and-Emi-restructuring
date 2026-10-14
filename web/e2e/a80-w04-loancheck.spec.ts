/**
 * Audit 80+ W4, end to end, signed out:
 *
 * A19  /rbi-decision: the latest RBI decision from the API, the new EMI or
 *      tenure on the user's own loan, next-meeting moves as scenarios (never
 *      odds), and the bridge to the plan.
 * A11  Loan Check leads with the rate rise: EMI vs tenure for this loan.
 * A16  every Loan Check result ends with the bridge to the plan and an
 *      amount-free WhatsApp share.
 * 390  both pages fit a 390 px phone: nothing wider than the viewport.
 *
 * The API's clock is the real one, so no assertion depends on which RBI
 * decision is the latest; the arithmetic is pinned in engine/api tests.
 */
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

async function noHorizontalOverflow(page: Page) {
  const wide = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const out: string[] = [];
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('body *'))) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      // A scroll region (the choices table) may be wider inside; its box may not.
      if (el.closest('[role="region"][tabindex]') && el.getAttribute('role') !== 'region') continue;
      if (r.right > vw + 1) out.push(`${el.tagName.toLowerCase()}.${el.className || ''} right=${Math.round(r.right)}`);
    }
    return { vw, sw: document.documentElement.scrollWidth, out: out.slice(0, 5) };
  });
  expect(wide.out, `elements past ${wide.vw}px`).toEqual([]);
  expect(wide.sw).toBeLessThanOrEqual(wide.vw);
}

async function fillRbi(page: Page) {
  await page.goto('/rbi-decision');
  await expect(page.getByTestId('mpc-latest')).toContainText(/the RBI moved the repo rate from/);
  await page.getByLabel('Still owed').fill('5000000');
  await page.getByLabel('Rate you pay now (%)').fill('7.90');
  await page.getByLabel('Months left').fill('240');
  await page.getByRole('button', { name: 'No, not yet' }).click();
  await page.getByTestId('mpc-submit').click();
}

test('A19: /rbi-decision works on your own loan, signed out, with scenarios and no odds', async ({ page }) => {
  await fillRbi(page);
  const result = page.getByTestId('mpc-result');
  await expect(result).toBeVisible();
  await expect(result.getByRole('region', { name: 'Your choices' })).toContainText('EMI');
  const scenarios = page.getByTestId('mpc-scenarios');
  await expect(scenarios).toContainText('No change: your EMI and tenure stay as above.');
  await expect(scenarios).toContainText(/A rise of 0\.25%/);
  await expect(scenarios).toContainText('Scenarios, not a forecast');
  // No market prices or odds anywhere on the page.
  await expect(page.locator('body')).not.toContainText(/odds|polymarket|kalshi|probability|chance of a/i);
  // Bridge: plan, full Loan Check, share.
  await expect(page.getByTestId('mpc-start-plan')).toHaveAttribute('href', '/onboarding?from=rbi-decision');
  await expect(page.getByTestId('mpc-loan-check')).toHaveAttribute('href', '/tools/loan-check');
});

test('A19: /rbi-decision says what is missing instead of calling the API', async ({ page }) => {
  await page.goto('/rbi-decision');
  await page.getByTestId('mpc-submit').click();
  await expect(page.getByRole('alert').filter({ hasText: 'Still needed' })).toContainText('Still needed: the outstanding balance, your current rate, months left.');
  await expect(page.getByTestId('mpc-result')).toHaveCount(0);
});

test('A16: a Loan Check result ends with the bridge to the plan and an amount-free share', async ({ page }) => {
  await page.goto('/tools/loan-check');
  await page.getByTestId('lc-lender').selectOption({ label: 'SBI' });
  await page.getByLabel('Rate you pay now (%)').fill('9.15');
  await page.getByLabel('Still owed').fill('3000000');
  await page.getByLabel('Months left').fill('200');
  await page.getByLabel('Month the loan started: month').selectOption({ label: 'March' });
  await page.getByLabel('Month the loan started: year').selectOption('2022');
  await page.getByLabel('What is the rate linked to?').selectOption('repo');
  await page.getByLabel('Rate when the loan started (%)').fill('9.15');
  await page.getByTestId('lc-spread-question').getByRole('button', { name: 'No', exact: true }).click();
  await page.getByRole('button', { name: /check my loan/i }).click();
  const bridge = page.getByTestId('lc-bridge');
  await expect(bridge).toBeVisible();
  await expect(page.getByTestId('lc-start-plan')).toHaveAttribute('href', '/onboarding?from=loan-check');
  const share = await page.getByTestId('lc-share-whatsapp').getAttribute('href');
  expect(share).toMatch(/^https:\/\/wa\.me\/\?text=/);
  const text = decodeURIComponent(share!.split('text=')[1]);
  // Amount-, rate- and lender-free: only the link to the free check.
  expect(text).not.toMatch(/₹|\d+(\.\d+)?%|SBI|3000000|30,00,000/);
  expect(text).toContain('/tools/loan-check');
});

test.describe('390 px phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('390: /rbi-decision fits, before and after a result', async ({ page }) => {
    await page.goto('/rbi-decision');
    await expect(page.getByTestId('mpc-latest')).toBeVisible();
    await noHorizontalOverflow(page);
    await fillRbi(page);
    await expect(page.getByTestId('mpc-result')).toBeVisible();
    await noHorizontalOverflow(page);
  });

  test('390: Loan Check fits', async ({ page }) => {
    await page.goto('/tools/loan-check');
    await expect(page.getByTestId('lc-lender')).toBeVisible();
    await noHorizontalOverflow(page);
  });
});
