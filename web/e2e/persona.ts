/** The live test's persona (rightdue-live-test.md), shared by the L5 specs.
 * EMIs are the standard formula, rounded up: ₹4L at 14% over 48 months =
 * ₹10,931; ₹25L at 8.6% over 240 months = ₹21,855. */
import type { Page } from '@playwright/test';
import { fillLoan, landedOnOnboarding, signIn, makeSetupChoices, continueToPlan } from './fixtures';

export const PERSONA_EMAIL = 'golden-l5-persona@rightdue.app';

export async function setUpPersona(page: Page, email = PERSONA_EMAIL) {
  await signIn(page, email);
  // A local rerun against a reused server finds the account already set up.
  if (!(await landedOnOnboarding(page))) return;
  await page.getByLabel(/Take-home pay a month/).fill('120000');
  await page.getByLabel(/Spending a month/).fill('40000');
  await page.getByRole('button', { name: /CONTINUE · WHAT YOU OWE/ }).click();
  await fillLoan(page, 0, { kind: /^card$/i, balance: '150000', rate: '42' });
  await fillLoan(page, 1, { kind: /^personal$/i, balance: '400000', rate: '14', emi: '10931' });
  await fillLoan(page, 2, { kind: /^home$/i, balance: '2500000', rate: '8.6', emi: '21855' });
  await page.getByRole('button', { name: /CONTINUE · SEE YOUR PLAN/ }).click();
  await makeSetupChoices(page);
  await page.getByRole('button', { name: /SAVE · OPEN MY PLAN/ }).click();
  await continueToPlan(page);
}

