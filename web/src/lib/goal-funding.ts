/**
 * Goal funding rules (roadmap PR F): how the plan pays into a goal.
 *
 *   after_debt (default, "debt first") — nothing until every high-interest
 *       loan (or one named loan) has cleared, then the run-rate to the date
 *   schedule    — the run-rate that lands it on its date, from now
 *   fixed       — a fixed amount a month
 *   surplus_pct — a share of each month's spare cash
 *
 * The engine applies them (engine/goals.py serial_fill_allocation); the
 * trade-off line prices funding a goal now against debt first
 * (/api/goals/tradeoff, engine goal_tradeoff).
 */
import type { GoalTradeoff, LoanPayload } from './api';
import { formatCurrencyWhole } from './api';
import { DEBT_FIRST, type GoalFundingRule } from './goals';
import { LOAN_TYPE_NAME } from './loan-types';

/** engine/goals.py HIGH_APR_THRESHOLD: "high-interest" for debt first. */
export const HIGH_APR_THRESHOLD: Record<string, number> = { IN: 0.12, US: 0.1 };

export function ruleOf(rule: GoalFundingRule | undefined): GoalFundingRule {
  return rule ?? { kind: 'schedule' };
}

export function isDebtFirst(rule: GoalFundingRule | undefined): boolean {
  return rule?.kind === 'after_debt' && (rule.afterLoanIndex ?? null) === null;
}

function loanName(l: LoanPayload | undefined): string {
  if (!l) return 'that loan';
  const type = LOAN_TYPE_NAME[l.loan_type] ?? 'loan';
  return l.bank ? `${l.bank} ${type}` : `your ${type}`;
}

/** The loans "debt first" waits for. */
export function highInterestLoans(loans: LoanPayload[], country: string): LoanPayload[] {
  const limit = HIGH_APR_THRESHOLD[country] ?? HIGH_APR_THRESHOLD.IN;
  return loans.filter((l) => Number(l.outstanding) > 0 && Number(l.nominal_rate) >= limit);
}

/** The rule in a few plain words. */
export function fundingRuleLabel(rule: GoalFundingRule | undefined, loans: LoanPayload[], country: string, currency: string): string {
  const r = ruleOf(rule);
  const pct = HIGH_APR_THRESHOLD[country] ?? HIGH_APR_THRESHOLD.IN;
  switch (r.kind) {
    case 'fixed':
      return `${formatCurrencyWhole(Number(r.amount || 0), currency)} a month`;
    case 'surplus_pct':
      return `${Math.round(Number(r.pct || 0) * 100)}% of spare cash`;
    case 'after_debt':
      return (r.afterLoanIndex ?? null) === null
        ? `Debt first: after every loan at ${Math.round(pct * 100)}% or more is paid off`
        : `After the ${loanName(loans[r.afterLoanIndex as number])} is paid off`;
    default:
      return 'On schedule from now';
  }
}

/** Whether the rule can be saved, else what's missing. */
export function fundingRuleError(rule: GoalFundingRule | undefined): string | null {
  const r = ruleOf(rule);
  if (r.kind === 'fixed' && !(Number(r.amount) > 0)) return 'Enter the amount a month.';
  if (r.kind === 'surplus_pct' && !(Number(r.pct) > 0 && Number(r.pct) <= 1)) return 'Enter a share between 1% and 100%.';
  return null;
}

/** The trade-off line: what funding this goal now, before high-interest debt, costs. */
export function tradeoffLine(t: GoalTradeoff, currency: string, targetLabel: string): string {
  if (!t.has_high_apr_debt) return 'No high-interest debt is open, so saving for it now costs no extra interest.';
  const extra = Math.max(0, Math.round(Number(t.extra_interest)));
  const later = t.debt_free_later_months;
  const cost = extra > 0
    ? `Saving for it now, before your high-interest debt, costs about ${formatCurrencyWhole(extra, currency)} more interest${later > 0 ? ` and leaves you in debt ${later} month${later === 1 ? '' : 's'} longer` : ''}.`
    : 'Saving for it now costs no extra interest.';
  const first = t.debt_first_reaches_target
    ? ` Debt first still reaches it by ${targetLabel}.`
    : ` Debt first reaches ${Math.round(Number(t.debt_first_fill_rate) * 100)}% of it by ${targetLabel}.`;
  return cost + first;
}

export { DEBT_FIRST };
