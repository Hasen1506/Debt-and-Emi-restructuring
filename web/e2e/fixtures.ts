import { test as base, expect, type Page, type Response } from '@playwright/test';

/** The test's "now": 7 Oct 2026, 10:00 IST (same instant the server uses). */
export const FROZEN_NOW = new Date(process.env.E2E_FROZEN_NOW ?? '2026-10-07T04:30:00.000Z');
export const OTP = '424242';

export const test = base.extend<{ page: Page }>({
  page: async ({ page, context }, use) => {
    // No network: only the local web app and API may answer.
    await context.route(
      (url) => !/^(localhost|127\.0\.0\.1)$/.test(url.hostname),
      (route) => route.abort('blockedbyclient'),
    );
    await page.clock.setFixedTime(FROZEN_NOW);
    await use(page);
  },
});
export { expect };

export async function signIn(page: Page, email: string) {
  await page.goto('/login');
  await page.getByPlaceholder('you@example.com').fill(email);
  await page.getByRole('button', { name: /send code/i }).click();
  await expect(page.getByText(`We sent a 6-digit code to ${email}`)).toBeVisible();
  await page.getByPlaceholder('••••••').fill(OTP);
  await page.getByRole('button', { name: /verify and sign in/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
}

/** The loan blocks on the setup "What you owe" step, in order. */
export function loanBlocks(page: Page) {
  return page.locator('[role=group]').filter({ has: page.getByRole('group', { name: 'Kind of loan' }) });
}

export interface LoanInput {
  kind: RegExp;            // chip name, e.g. /^home$/i
  currency?: 'INR' | 'USD'; // set through "More terms" when not the home currency
  balance: string;
  rate: string;            // percent a year
  emi?: string;            // EMI loans only
}

export async function fillLoan(page: Page, index: number, loan: LoanInput) {
  if (index > 0) await page.getByRole('button', { name: /ADD ANOTHER LOAN/ }).click();
  const b = loanBlocks(page).nth(index);
  await b.getByRole('button', { name: loan.kind }).click();
  if (loan.currency) {
    await b.getByRole('button', { name: /MORE TERMS/ }).click();
    await b.getByLabel('Currency', { exact: true }).selectOption(loan.currency);
  }
  const card = loan.emi === undefined;
  await b.getByLabel(card ? 'Balance on the card' : 'Balance left to repay').fill(loan.balance);
  await b.getByLabel(card ? 'Card APR, % a year' : 'Interest rate, % a year').fill(loan.rate);
  if (!card) {
    await b.getByLabel('EMI a month').fill(loan.emi!);
    await b.getByRole('button', { name: /PAID ALREADY/ }).click();
  }
}

/** A compact, stable summary of a /api/simulate or /api/baseline response. */
export async function planSummary(res: Response) {
  const body = await res.json();
  const traj = body.trajectory as { month: number; balance: string; interest_paid: string; total_paid: string }[];
  return {
    debt_free_month: body.debt_free_month,
    total_interest_paid: Number(body.total_interest_paid).toFixed(2),
    months_in_horizon: body.months_in_horizon,
    yearly: traj
      .filter((p) => p.month === 1 || p.month % 12 === 0 || p.month === traj.length)
      .map((p) => ({ month: p.month, balance: p.balance, interest: p.interest_paid, paid: p.total_paid })),
  };
}

export function isPlanCall(path: '/api/simulate' | '/api/baseline') {
  return (r: Response) => r.request().method() === 'POST' && new URL(r.url()).pathname === path && r.ok();
}

/** Headline figures and the month-by-month table on /plan, as plain text. */
export async function planText(page: Page) {
  await expect(page.getByRole('heading', { name: /^MONTH BY MONTH/ })).toBeVisible();
  const table = page.locator('table').filter({ hasText: 'EVENT' }).first();
  const rows = await table.locator('tr').allInnerTexts();
  return rows.map((r) => r.replace(/\s+/g, ' ').trim()).join('\n') + '\n';
}

export function money(text: string): number {
  return Number(text.replace(/[^0-9.\-]/g, ''));
}
