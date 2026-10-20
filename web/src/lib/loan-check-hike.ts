/**
 * Pure helpers for the hike-cycle Loan Check (audit 80+ A11, A16, A19):
 * the plan bridge, the amount-free share text, the rate-history rows and
 * the EMI-or-tenure rows. No React, so node tests can load them.
 */
import { formatCurrency, formatPct, type LoanCheckResponse, type RateMoveImpact } from '@/lib/api';
import { parsePercentInput } from '@/lib/rate-input';

export const SITE = 'https://rightdue.app';

/** Where "Start your plan" goes. Setup asks for sign-in first (founder
 *  decision); `from` lets the counts-only funnel see the bridge worked. */
export const PLAN_HREF = '/onboarding?from=loan-check';
export const PLAN_HREF_MPC = '/onboarding?from=rbi-decision';

/** A16: the line after any result, including "no issue". */
export function bridgeLine(r: Pick<LoanCheckResponse, 'status' | 'findings'>): string {
  const fine = r.status !== 'issues_found' && !r.findings.some((f) => f.kind === 'choice_not_offered' || f.kind === 'asymmetric_pass_through');
  return fine
    ? 'Your loan is fine today. Want us to watch it, and your other EMIs, every month?'
    : 'Want us to watch this loan, and your other EMIs, every month while you sort this out?';
}

/** A16: share text with no amounts, rates or lender: only what the tool does. */
export function shareText(where: 'loan-check' | 'rbi-decision'): string {
  return where === 'loan-check'
    ? `I checked my home-loan rate against every RBI repo move, free and without signing in: ${SITE}/tools/loan-check`
    : `What the RBI's latest decision does to your home-loan EMI or tenure, free and without signing in: ${SITE}/rbi-decision`;
}

export function whatsappHref(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

export interface HistoryRow {
  month: string;   // "YYYY-MM" from the month picker
  rate: string;    // percent as typed, "8.40"
}

/** Rows the borrower typed → the API's rate_history, or the first problem. */
export function historyToRequest(rows: HistoryRow[]): { history: { month: string; rate: string }[]; error: string | null } {
  const out: { month: string; rate: string }[] = [];
  for (const [i, r] of rows.entries()) {
    if (!r.month && !r.rate) continue;
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(r.month)) return { history: [], error: `Row ${i + 1}: pick the month the rate changed.` };
    const p = parsePercentInput(r.rate);
    if (p.error || !p.fraction) return { history: [], error: `Row ${i + 1}: ${p.error ?? 'enter the rate, like 8.40'}` };
    out.push({ month: r.month, rate: p.fraction });
  }
  return { history: out, error: null };
}

const inr = (v: string | number) => formatCurrency(String(v), 'INR');

/** The three choices a rise gives the borrower, as table rows. */
export function impactRows(im: RateMoveImpact): { option: string; monthly: string; months: string; interest: string }[] {
  const extraInterest = (total: string | null) => {
    if (total == null) return '—';
    const delta = Number(total) - Number(im.interest_before);
    if (delta > 0) return `+${inr(delta)}`;
    if (delta < 0) return `${inr(Math.abs(delta))} less`;
    return inr(0);
  };
  const emiDelta = Number(im.emi_change);
  const rows = [
    {
      option: emiDelta < 0 ? 'Keep the end date (level EMI is lower)' : 'Raise the EMI, keep the end date',
      monthly: emiDelta < 0
        ? `${inr(im.emi_after)} (${inr(Math.abs(emiDelta))} less)`
        : `${inr(im.emi_after)} (+${inr(emiDelta)})`,
      months: `${im.months_before} left (same)`,
      interest: extraInterest(im.interest_emi_option),
    },
    {
      option: 'Keep the EMI, change the tenure',
      monthly: im.tenure_option_possible ? `${inr(im.emi_before)} (same)` : 'Not allowed',
      months: im.tenure_option_possible && im.months_after != null
        ? `${im.months_after} left (${(im.months_change ?? 0) >= 0 ? '+' : ''}${im.months_change})`
        : 'the EMI would not cover the interest',
      interest: im.tenure_option_possible ? extraInterest(im.interest_tenure_option) : '—',
    },
  ];
  if (Number(im.prepay_to_keep_both) > 0) {
    rows.push({
      option: `Prepay ${inr(im.prepay_to_keep_both)} now`,
      monthly: `${inr(im.emi_before)} (same)`,
      months: `${im.months_before} left (same)`,
      interest: 'the prepayment replaces the extra interest',
    });
  }
  return rows;
}

/** Scenario line: a rise's new EMI, with a lower level EMI said as "less". */
export function scenarioEmi(im: RateMoveImpact): string {
  const delta = Number(im.emi_change);
  if (delta < 0) return `EMI ${inr(im.emi_after)} (${inr(Math.abs(delta))} less a month)`;
  return `EMI ${inr(im.emi_after)} (+${inr(im.emi_change)} a month)`;
}

export function scenarioTenure(im: RateMoveImpact): string {
  if (!im.tenure_option_possible || im.months_change == null) {
    return ', and keeping the EMI would no longer cover the interest';
  }
  if (im.months_change > 0) return `, or ${im.months_change} more months at today's EMI`;
  if (im.months_change < 0) return `, or ${-im.months_change} fewer months at today's EMI`;
  return `, or the same number of months at today's EMI`;
}

/** "0.25%" for a move, with its direction in words. */
export function moveWords(move: string): string {
  const n = Number(move);
  if (n === 0) return 'no change';
  return `${n > 0 ? 'a rise' : 'a cut'} of ${formatPct(String(Math.abs(n)), 2)}`;
}
