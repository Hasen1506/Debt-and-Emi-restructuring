/**
 * The order each strategy puts the open loans in, by the engine's rules
 * (engine/ordering.py rank_loans): avalanche by the marginal cost of the
 * next payment (lib/marginal-cost, roadmap PR J), snowball
 * by balance, your rules (lib/payoff-rules) then by rate. When all three
 * agree, they share today's starting order. Balances, floating-rate
 * resets and future loans can still change the later order and outcome.
 */
import type { UserPayload } from './api';
import { userMarginalCosts } from './marginal-cost';
import { isOpenCurrentLoan } from './plan-controls';
import { LOAN_TYPE_NAME } from './loan-types';
import type { StrategyName } from './strategy';
import { applyRules, rulesOrDefault, parseRules } from './payoff-rules';

/** Fee the ranker may use. Mirrors engine/prepayment_fee.py without the lender
 *  catalogue, so this file stays out of the letters page's extra download. */
function rankLoan<T extends UserPayload['loans'][number]>(loan: T, country: UserPayload['country']): T {
  const market = loan.currency === 'USD' ? 'US' : loan.currency === 'INR' ? 'IN' : country;
  const given = loan.lender_type as string | undefined;
  const lender = given === 'commercial_bank' ? 'bank' : given === 'unknown' ? undefined : given;
  const year = loan.sanction_year ?? 0;
  const amtRaw = loan.sanctioned_amount as unknown;
  const amt = amtRaw == null || String(amtRaw).trim() === '' ? NaN : Number(amtRaw);
  const cap = lender === 'small_finance_bank' || lender === 'regional_rural_bank' || lender === 'hfc';
  // Same branch order as prepaymentFeeDefault / engine/prepayment_fee.py.
  const inScope = market === 'IN' && loan.rate_type === 'floating' && loan.loan_type !== 'credit_card' && lender !== 'other';
  const olderIndividual = (lender === 'regional_rural_bank' || lender === 'cooperative_bank') && year < 2026;
  const businessBarred = olderIndividual || (year >= 2026 && (lender === 'bank' || (cap && Number.isFinite(amt) && amt <= 5_000_000)));
  const unanswered = loan.business_purpose == null && (loan.loan_type === 'loan_against_property' || loan.loan_type === 'gold_loan');
  const barred = inScope && (unanswered ? businessBarred : (loan.business_purpose ? businessBarred : true));
  if (!barred) return loan;
  const lock = year >= 2026 ? 0 : loan.prepay_lock_in_months;
  const raw = (loan.prepayment_penalty_pct ?? '').trim();
  if ((raw === '' || raw === '0') && lock === loan.prepay_lock_in_months) return loan;
  return { ...loan, prepayment_penalty_pct: '0', prepay_lock_in_months: lock };
}

export function payoffOrders(user: UserPayload, marginalRate: string): Record<StrategyName, number[]> {
  const priced = { ...user, loans: user.loans.map((l) => rankLoan(l, user.country)) };
  const idx = priced.loans.flatMap((l, i) => (isOpenCurrentLoan(l) ? [i] : []));
  // Avalanche and the rules' "by rate" fallback rank by the marginal cost
  // of the next payment (roadmap PR J), as the engine does.
  const mcs = userMarginalCosts(priced, marginalRate, idx);
  const eff = new Map(idx.map((i) => [i, mcs.get(i)?.orderKey.toNumber() ?? 0]));
  const bal = (i: number) => Number(user.loans[i].outstanding);
  const byRate = (a: number, b: number) => (eff.get(b) ?? 0) - (eff.get(a) ?? 0);
  const byBalance = (a: number, b: number) => bal(a) - bal(b);
  const rules = rulesOrDefault(parseRules(user.payoff_rules), user.country);
  return {
    avalanche: [...idx].sort(byRate),
    snowball: [...idx].sort(byBalance),
    rules: applyRules(idx, rules, (i) => eff.get(i) ?? 0, bal),
  };
}

/** The loans' names in the one order all three strategies share, or null
 *  when the strategies differ (or there's nothing to order). */
export function sharedPayoffOrder(user: UserPayload, marginalRate: string): string[] | null {
  const o = payoffOrders(user, marginalRate);
  const key = o.avalanche.join(',');
  if (o.avalanche.length === 0 || o.snowball.join(',') !== key || o.rules.join(',') !== key) return null;
  return o.avalanche.map((i) => {
    const l = user.loans[i];
    const type = LOAN_TYPE_NAME[l.loan_type];
    const bank = (l.bank ?? '').replace(/\s+bank$/i, '').trim();
    return bank ? `${bank} ${type}` : type.charAt(0).toUpperCase() + type.slice(1);
  });
}
