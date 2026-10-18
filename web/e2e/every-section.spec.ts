/**
 * One seeded household, every screen that shows a figure. The balance, the
 * EMI and the card balance typed in setup must read the same on Home, Plan
 * and Profile. Loan check is one loan, the home loan, so it shows that
 * balance and not the card. A page that does not show the household's
 * loans must not invent their total.
 */
import { expect, fillLoan, makeSetupChoices, signIn, test } from './fixtures';

const ROUTES = [
  '/',
  '/plan',
  '/activity',
  '/profile',
  '/profile/assets',
  '/profile/assumptions',
  '/portfolio',
  '/tax',
  '/goals',
  '/cant-pay',
  '/glossary',
  '/rbi-decision',
  '/tools/windfall',
  '/tools/new-debt',
  '/tools/liquidate',
  '/tools/invest-vs-prepay',
  '/tools/loan-check',
  '/account',
];

const SHOWS_LOAN = ['/', '/plan', '/profile'];
const SHOWS_EMI = ['/', '/plan', '/profile', '/activity', '/cant-pay'];

test('seeded balances and the EMI match on every screen that shows them', async ({ page }) => {
  await signIn(page, 'every-section@rightdue.app');
  await page.getByLabel(/Take-home pay a month/).fill('150000');
  await page.getByLabel(/Spending a month/).fill('45000');
  await page.getByRole('button', { name: /CONTINUE · WHAT YOU OWE/ }).click();
  await fillLoan(page, 0, { kind: /^home$/i, balance: '3500000', rate: '8.5', emi: '35200', emiGoneOut: 'due' });
  await fillLoan(page, 1, { kind: /^card$/i, balance: '80000', rate: '42' });
  await page.getByRole('button', { name: /CONTINUE · SEE YOUR PLAN/ }).click();
  await makeSetupChoices(page);
  await page.getByRole('button', { name: /SAVE · OPEN MY PLAN/ }).click();
  await page.waitForURL('**/plan');
  await expect(page.getByText('₹35,00,000').first()).toBeVisible();

  const text = new Map<string, string>();
  for (const route of ROUTES) {
    await page.goto(route);
    await page.waitForTimeout(1500);
    text.set(route, await page.locator('#main, main, body').first().innerText());
  }

  for (const route of SHOWS_LOAN) {
    expect(text.get(route), route).toContain('₹35,00,000');
    expect(text.get(route), route).toContain('₹80,000');
  }
  expect(text.get('/tools/loan-check'), '/tools/loan-check').toContain('₹35,00,000');
  for (const route of SHOWS_EMI) {
    expect(text.get(route), route).toContain('₹35,200');
  }
  // The plan's debt-free month is the same fact on Home.
  const plan = text.get('/plan') ?? '';
  const debtFree = plan.match(/Debt-free: ([A-Za-z]+ \d{4})/);
  expect(debtFree, plan.slice(0, 400)).not.toBeNull();
  const month = debtFree![1].slice(0, 3);
  expect(text.get('/'), 'home debt-free month').toContain(month);

  // Pages that are not this household's loans stay clear of the total.
  for (const route of ['/glossary', '/account', '/profile/assets']) {
    expect(text.get(route), route).not.toContain('₹35,80,000');
  }
});
