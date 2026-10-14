/**
 * Live re-test 4, 13 Oct 2026 (LIVE-RETEST-4-2026-10-13.md):
 *  - NEW-19: quick choice clicks in Setup step 3 settle into one
 *    /api/simulate + /api/baseline pair; a strategy click doesn't re-send
 *    the baseline; the preview shows the last choice; the what-if buttons
 *    on Plan send one compare per settled choice.
 *  - R4-1: Invest or prepay names the field that stops the answer.
 */
import { expect, fillLoan, makeSetupChoices, planPreviewSettled, signIn, test } from './fixtures';
import type { Page, Request } from '@playwright/test';

const shots = process.env.FIX4_SHOTS;

function track(page: Page) {
  const sent: { path: string; body: Record<string, unknown> }[] = [];
  page.on('request', (r: Request) => {
    const path = new URL(r.url()).pathname;
    if (r.method() === 'POST' && ['/api/simulate', '/api/baseline', '/api/sensitivity/compare'].includes(path)) {
      sent.push({ path, body: JSON.parse(r.postData() ?? '{}') });
    }
  });
  return sent;
}

async function onboard(page: Page, email: string) {
  await signIn(page, email);
  await expect(page).toHaveURL(/\/onboarding$/);
  await page.getByLabel(/Take-home pay a month/).fill('120000');
  await page.getByLabel(/Spending a month/).fill('40000');
  await page.getByRole('button', { name: /CONTINUE · WHAT YOU OWE/ }).click();
  await fillLoan(page, 0, { kind: /^card$/i, balance: '150000', rate: '42' });
  // ₹1L personal (smaller than the card, cheaper than it): smallest-first and
  // cheapest-first now differ, so (A2, W3) the order question is asked. With
  // ₹4L every order paid card → personal → home and the chips were replaced
  // by the "same result" line.
  await fillLoan(page, 1, { kind: /^personal$/i, balance: '100000', rate: '14', emi: '13000' });
  await fillLoan(page, 2, { kind: /^home$/i, balance: '2500000', rate: '8.6', emi: '22000' });
  await page.getByRole('button', { name: /CONTINUE · SEE YOUR PLAN/ }).click();
}

test('NEW-19: rapid Setup choices settle into one plan request pair', async ({ page }) => {
  const sent = track(page);
  await onboard(page, 'golden-retest4-rapid@rightdue.app');
  await planPreviewSettled(page);
  // The first preview: one pair, plus (audit 80 B4/A22, W6) the same loans
  // smallest-first, "what you'd likely do", the savings baseline.
  await expect.poll(() => sent.length).toBe(3);
  expect(sent.map((s) => s.path).sort()).toEqual(['/api/baseline', '/api/simulate', '/api/simulate']);
  expect(sent.filter((s) => s.path === '/api/simulate' && s.body.strategy === 'snowball')).toHaveLength(1);

  // Four quick choices, faster than the pause.
  const order = page.getByRole('group', { name: 'Which loan gets your extra money first?' }).getByRole('button');
  const n = await order.count();
  expect(n).toBeGreaterThan(1);
  const before = sent.length;
  await page.getByRole('button', { name: /^Not now$/ }).click();
  for (let i = n - 1; i >= 1; i--) await order.nth(i).click({ delay: 0 });
  const last = order.nth(1);
  await expect(last).toHaveAttribute('aria-pressed', 'true');
  await planPreviewSettled(page);
  await page.waitForTimeout(800);
  const burst = sent.slice(before);
  // One settled simulate for the last choice; the baseline (minimums only)
  // doesn't depend on the order, so it is not sent again.
  expect(burst.filter((s) => s.path === '/api/simulate')).toHaveLength(1);
  expect(burst.filter((s) => s.path === '/api/baseline')).toHaveLength(0);
  const lastLabel = (await last.innerText()).match(/\(([^)]+)\)/)?.[1]?.toLowerCase();
  const names: Record<string, string> = { avalanche: 'avalanche', snowball: 'snowball', 'your rules': 'rules' };
  expect(String(burst[0].body.strategy)).toBe(names[lastLabel ?? '']);

  // Going back to an order already worked out answers from memory.
  const again = sent.length;
  await makeSetupChoices(page);
  await expect(page.getByText(/Working out your plan|couldn't be worked out/)).toHaveCount(0);
  expect(sent.slice(again).filter((s) => s.path === '/api/baseline')).toHaveLength(0);
  expect(sent.slice(again).filter((s) => s.path === '/api/simulate').length).toBeLessThanOrEqual(1);
  if (shots) await page.screenshot({ path: `${shots}/after-new19-setup-1366.png`, fullPage: false });

  await page.getByRole('button', { name: /SAVE · OPEN MY PLAN/ }).click();
  await page.waitForURL('**/plan');
  // Plan's tenure what-if: three quick clicks, one compare for the last.
  const plus5 = page.getByRole('button', { name: '+5 YRS' });
  await expect(plus5).toBeVisible();
  await page.waitForLoadState('networkidle');
  const atPlan = sent.length;
  await plus5.click();
  await page.getByRole('button', { name: '+10 YRS' }).click();
  await plus5.click();
  await expect(page.locator('#main').getByTestId('whatif-toggle')).toContainText(/\+5 YRS/);
  await page.waitForTimeout(800);
  const compares = sent.slice(atPlan).filter((s) => s.path === '/api/sensitivity/compare');
  expect(compares).toHaveLength(1);
  expect(compares[0].body.tenure_extension_months).toBe(60);
});

test('R4-1: Invest or prepay names the invalid field in the answer box', async ({ page }) => {
  await onboard(page, 'golden-retest4-ivp@rightdue.app');
  await makeSetupChoices(page);
  await page.getByRole('button', { name: /SAVE · OPEN MY PLAN/ }).click();
  await page.waitForURL('**/plan');
  await page.goto('/tools/invest-vs-prepay');
  await expect(page).toHaveURL(/\/tools\/invest-vs-prepay/);
  const loanRate = page.getByLabel("The loan's rate, a year (%)");
  const tax = page.getByLabel('Your tax rate (%)');
  await loanRate.fill('14');
  await tax.fill('15.6');
  const answer = page.locator('[aria-labelledby="ivp-out"]');
  const ret = page.getByLabel(/Today's rate \(%\)|It earns a year, on average \(%\)/);
  await ret.fill('abc');
  await expect(ret).toHaveAttribute('aria-invalid', 'true');
  await expect(answer).toContainText(/Fix (today’s rate|what it earns a year) to see the answer\./);
  await expect(answer).not.toContainText("Enter the loan's rate and your tax rate");
  await expect(answer).not.toContainText('Enter the loan’s rate and your tax rate');
  await ret.fill('500');
  await expect(answer).toContainText(/Fix (today’s rate|what it earns a year) to see the answer\./);
  if (shots) await page.screenshot({ path: `${shots}/after-r4-1-ivp-return-1366.png`, fullPage: false });
  await ret.fill('7');
  // An equity fund: the swing field is named when it is the one that's wrong.
  const fund = page.getByRole('button', { name: /index fund|equity/i }).first();
  if (await fund.count()) {
    await fund.click();
    const swing = page.getByLabel('How much it swings a year (%)');
    await swing.fill('abc');
    await expect(answer).toContainText('Fix how much it swings to see the answer.');
    await swing.fill('16');
    await expect(answer).not.toContainText('to see the answer.');
  }
  // Both loan fields blank: it still asks for them.
  await loanRate.fill('');
  await tax.fill('');
  await expect(answer).toContainText('Enter the loan’s rate and your tax rate to see the answer.');
});
