/**
 * Round 3 part B (UX walkthrough 2: #10, #13, #21). Three per-loan answers
 * the plan used to miss, kept here so lib/api.ts (grandfathered, may only
 * shrink) doesn't grow: the fields join LoanPayload by declaration merging.
 *
 *   house_use       what a loan against property / home-loan top-up paid
 *                   for. Only a house (buy, build, repair) gets home-loan tax
 *                   relief; see lib/loan-types taxType / engine tax_type.
 *   debt_status     normal / behind / with a collection agency / settled.
 *                   Behind or collections: Home stops saying "pay the
 *                   minimum" and points to /cant-pay. Settled: out of the
 *                   plan (the API sends it as nothing owed), shown as closed.
 *   salary_deducted the EMI is cut from pay before it reaches the bank, so
 *                   take-home is already net of it: the API adds it back
 *                   before the plan takes every EMI off (api/schemas.py).
 */
import type { LoanType } from './api';

export type HouseUse = 'buy_build' | 'repair' | 'other';
export type DebtStatus = 'normal' | 'behind' | 'collections' | 'settled';

declare module './api' {
  interface LoanPayload {
    house_use?: HouseUse | null;
    debt_status?: DebtStatus;
    /** Founder 17 Oct 2026: how much a behind loan is behind by (blank =
     *  one EMI, estimated), and the day it was marked behind. */
    overdue_amount?: string | null;
    overdue_as_of?: string;
    salary_deducted?: boolean;
  }
  interface TrajectoryPointRaw {
    /** engine/debt_status.py, by loan position: the overdue paid on a behind
     *  loan (loan currency) and each collections loan's settlement pot (user currency). */
    catch_up_by_loan_index?: Record<string, string>;
    settlement_pot_by_loan_index?: Record<string, string>;
  }
}

/** "Was it used for a house?" — one line each, plain words. */
export const HOUSE_USE_CHOICES: Array<[HouseUse, string, string]> = [
  ['buy_build', 'Bought or built a house', 'Interest up to ₹2L a year (old regime, self-occupied).'],
  ['repair', 'Repaired or renovated a house', 'Interest up to ₹30,000 a year (old regime); principal doesn’t count in 80C.'],
  ['other', 'Something else', 'Business, a wedding, other loans: no tax break.'],
];

/** One line each, shown under the choice. */
export const DEBT_STATUS_CHOICES: Array<[DebtStatus, string, string]> = [
  ['normal', 'Paying normally', 'You’re paying on time.'],
  ['behind', 'Behind on payments', 'You’ve missed one or more payments and the lender is chasing them.'],
  ['collections', 'With a collection agency', 'An agency, not the lender, is now asking you to pay.'],
  ['settled', 'Settled or closed', 'You paid a settlement or closed it. It leaves the plan.'],
];

export const SALARY_DEDUCTED_LABEL = 'Taken from my salary before it reaches the bank';
export const SALARY_DEDUCTED_HINT =
  'Your take-home is already after this EMI, so the plan won’t take it off again. It still tracks the loan.';

// The predicates live in loan-status-core (no copy), so lib/derived and
// Home's pay list don't pull these strings into every route's bundle.
export { canBeSalaryDeducted, catchUpProgress, debtStatus, emiOffTakeHome, isSettled, needsHelp, overdueOf } from './loan-status-core';
import { debtStatus } from './loan-status-core';

/**
 * What Home says for a loan that is behind or with collectors, instead of
 * "pay the minimum". Legal notes are drafts pending review (lib/legal-review).
 */
export function helpLines(l: { debt_status?: DebtStatus; loan_type: LoanType }, country: 'IN' | 'US'): string[] {
  const s = debtStatus(l);
  if (s !== 'behind' && s !== 'collections') return [];
  const lines = s === 'behind'
    ? [
        'Your plan now puts spare cash on what’s overdue first, before the emergency fund or other loans; then the normal plan resumes.',
        'Can’t catch up? Call or write to the lender before the next due date and ask for a hardship plan: a pause, lower payments or a longer term.',
        'Pay what you can on this loan first if it’s secured (a house, a vehicle, gold); don’t borrow at a higher rate to catch up.',
      ]
    : [
        'Don’t pay a collector until you know the debt is yours and the amount is right: ask for it in writing.',
        'Keep every letter and a note of each call (date, time, name).',
        'The plan puts no extra on it: its share goes to a settlement pot you keep (see this month’s payments). To pay it anyway, pin it on Plan or use MY SPLIT.',
      ];
  if (l.loan_type === 'medical_loan' && country === 'US') {
    lines.push('A medical bill: ask the hospital for an itemized bill and its financial-assistance (charity care) policy.');
  }
  return lines;
}

/** The rights note beside the help lines (marked DRAFT pending legal review). */
export function rightsNote(country: 'IN' | 'US'): string {
  return country === 'US'
    ? 'Your rights (FDCPA, 12 CFR 1006): within 30 days of a collector’s first notice you can dispute the debt and ask them to prove it; until they do, they must pause collecting. You can tell them in writing to stop contacting you. No calls before 8 am or after 9 pm your time.'
    : 'Your rights (RBI fair practices code and recovery-agent rules): agents may call only between 8 am and 7 pm, must show their authorisation, and may not threaten, abuse or shame you or your family. Complain to the lender first, then the RBI Ombudsman (cms.rbi.org.in).';
}

/** Under a settled loan. */
export const SETTLED_NOTE: Record<'IN' | 'US', string> = {
  IN: 'Closed. A settled loan shows as “settled” on your CIBIL report for up to 7 years and can make new loans harder. Keep the lender’s no-dues letter.',
  US: 'Closed. A settled account usually stays on your credit report for 7 years from the first missed payment. Keep the settlement letter.',
};

/** US medical debt: its own short guidance (credit-reporting line to verify). */
export const US_MEDICAL_NOTES = [
  'Medical bills often charge no interest: check before paying them ahead of other debts.',
  'Ask for an itemized bill; errors are common. Ask about financial assistance (charity care) and a no-interest payment plan.',
  'You can ask the provider to hold the bill from collections while you sort out insurance or assistance.',
  'Credit reports: paid medical debt and medical debt under $500 are not shown by the three big bureaus (as of 2023; verify).',
];

/** Setup / Profile, under "Behind on payments" (founder 17 Oct 2026). */
export const OVERDUE_LABEL = 'How much are you behind?';
export const OVERDUE_HINT = 'The missed payments plus any late fees. Leave it blank and we’ll use one EMI as an estimate.';

/** Home, beside a collections loan's settlement pot (marked DRAFT: legal review). */
export const POT_WHY =
  'Kept by you, not paid to the collector: paying a collector in bits weakens your hand when you negotiate a settlement. The plan doesn’t count it as paid.';

/** Windfall MY SPLIT: shown when money goes to a collections loan (never blocked). */
export const COLLECTIONS_SPLIT_NOTE =
  'With a collection agency: ask for the debt in writing before paying, and pay a settlement in one go rather than in bits. Your choice stands.';
