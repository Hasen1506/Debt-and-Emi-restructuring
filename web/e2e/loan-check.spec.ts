/**
 * Loan Check, end to end (Sprint G5): the live-test findings on rightdue.app
 * (Oct 2026) replayed in a browser against the real API.
 *
 * L#7  a rate below what the repo moves imply reads as good news
 * L#8  the same numbers give the same verdict whatever the lender name;
 *      a housing finance company gets its own rules, not the bank verdict
 * L#9  the spread question is always asked
 * L#10 the lender is picked from a list (or named with a stated type)
 * L#28 the ₹ figures say they are estimates
 * #54  a complaint letter is a draft, unlocked by a self-check
 * #5   the reset watch says when to look again
 *
 * Signed out, so nothing comes from a saved profile. The API's clock is the
 * real one, so no assertion depends on today's date.
 */
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

interface Loan {
  lender?: string;               // a listed lender's name
  other?: { name: string; type: string };
  start: { month: string; year: string };
  startRate: string;
  rate: string;
  owed: string;
  months: string;
  spread?: 'No' | 'Yes' | 'Not sure';
}

const LIVE: Loan = {
  lender: 'SBI',
  start: { month: 'March', year: '2022' },
  startRate: '9.15',
  rate: '9.15',
  owed: '3000000',
  months: '200',
  spread: 'No',
};

async function fill(page: Page, loan: Loan) {
  await page.goto('/tools/loan-check');
  const lender = page.getByTestId('lc-lender');
  await expect(lender.locator('option', { hasText: 'LIC Housing Finance' })).toHaveCount(1);
  if (loan.other) {
    await lender.selectOption({ label: 'Another lender (not listed)' });
    await page.getByLabel("Lender's name").fill(loan.other.name);
    await page.getByLabel('What kind of lender?').selectOption({ label: loan.other.type });
  } else if (loan.lender) {
    await lender.selectOption({ label: loan.lender });
  }
  await page.getByLabel('Rate you pay now (%)').fill(loan.rate);
  await page.getByLabel('Still owed').fill(loan.owed);
  await page.getByLabel('Months left').fill(loan.months);
  await page.getByLabel('Month the loan started: month').selectOption({ label: loan.start.month });
  await page.getByLabel('Month the loan started: year').selectOption(loan.start.year);
  await page.getByLabel('What is the rate linked to?').selectOption('repo');
  await page.getByLabel('Rate when the loan started (%)').fill(loan.startRate);
  if (loan.spread) {
    await page.getByTestId('lc-spread-question').getByRole('button', { name: loan.spread, exact: true }).click();
  }
}

async function check(page: Page) {
  await page.getByRole('button', { name: /check my loan/i }).click();
}

test('L#9: the spread question must be answered before the check runs', async ({ page }) => {
  await fill(page, { ...LIVE, spread: undefined });
  await check(page);
  await expect(page.getByText(/Still needed: whether your spread changed/).first()).toBeVisible();
  await page.getByTestId('lc-spread-question').getByRole('button', { name: 'Yes', exact: true }).click();
  await expect(page.getByLabel(/By how much\?/)).toBeVisible();
});

test('L#7 + L#28: paying below the repo-implied rate is in your favour, with nothing to claim', async ({ page }) => {
  await fill(page, LIVE);
  await check(page);
  await expect(page.getByText('You pay less than the repo moves imply: in your favour.')).toBeVisible();
  await expect(page.getByText('1.50% below', { exact: true })).toBeVisible();
  await expect(page.getByText(/in your favour, nothing to claim/i).first()).toBeVisible();
  await expect(page.getByText('Worth a conversation with your bank.')).toHaveCount(0);
  // The new-borrower comparison is a labelled side note that never decides the verdict.
  await expect(page.getByTestId('lc-new-borrower-note')).toContainText('never changes the verdict');
  await expect(page.getByText(/estimate for your own conversation with the bank/).first()).toBeVisible();
  // No complaint is offered when nothing is owed.
  await expect(page.getByText('Write the complaint')).toHaveCount(0);
  await expect(page.getByTestId('lc-reset-watch')).toBeVisible();
});

test('L#8: same numbers, an unlisted bank, the same verdict and an explicit "no rate card" note', async ({ page }) => {
  await fill(page, { ...LIVE, lender: undefined, other: { name: 'Some Bank I Typed', type: 'Bank (public, private or foreign)' } });
  await check(page);
  await expect(page.getByText('You pay less than the repo moves imply: in your favour.')).toBeVisible();
  await expect(page.getByTestId('lc-new-borrower-note')).toContainText(
    "We don't have a published new-borrower rate card for Some Bank I Typed",
  );
});

test('L#8 + L#10: a housing finance company gets its own rules, not the bank verdict', async ({ page }) => {
  await fill(page, { ...LIVE, lender: 'LIC Housing Finance' });
  await expect(page.getByText(/does not bind it/)).toBeVisible();
  await check(page);
  await expect(page.getByText("The repo-rate rule for banks doesn't bind this lender.")).toBeVisible();
  await expect(page.getByText(/National Housing Bank/).first()).toBeVisible();
  await expect(page.getByText(/60 days/).first()).toBeVisible();
  await expect(page.getByText('Write the complaint')).toHaveCount(0);
});

test('#54 + #40: a missed cut gives a draft letter, quoted rules and a self-check before copy', async ({ page }) => {
  await fill(page, {
    ...LIVE,
    start: { month: 'January', year: '2024' },
    startRate: '9.00',
    rate: '9.50',
  });
  await check(page);
  await expect(page.getByText('Your rate looks higher than the RBI rules allow.')).toBeVisible();
  await expect(page.getByText('ESTIMATE, NEXT 12 MONTHS')).toBeVisible();
  await expect(page.getByText(/not a confirmed refund/).first()).toBeVisible();
  // The rule's own words, with its paragraph.
  await expect(page.getByText(/“38\. The interest rate under external benchmark shall be reset at least once in three months\.”/).first()).toBeVisible();
  await expect(page.getByTestId('lc-draft-notice')).toContainText('Draft. Check before sending.');
  const copy = page.getByRole('button', { name: 'Copy', exact: true }).first();
  await expect(copy).toBeDisabled();
  const boxes = page.getByTestId('lc-self-check').getByRole('checkbox');
  const n = await boxes.count();
  expect(n).toBeGreaterThanOrEqual(5);
  for (let i = 0; i < n; i++) await boxes.nth(i).check();
  await expect(copy).toBeEnabled();
});
