/**
 * The order each strategy puts the open loans in, by the engine's rules
 * (engine/ordering.py rank_loans): avalanche by effective rate, snowball
 * by balance, hybrid small balances first then by rate. When all three
 * agree, they share today's starting order. Balances, floating-rate
 * resets and future loans can still change the later order and outcome.
 */
import type { UserPayload } from './api';
import { computeBreakdown } from './effective-apr';
import { usMortgageShieldShare } from './deductions';
import { isOpenCurrentLoan } from './plan-controls';
import { LOAN_TYPE_NAME } from './loan-types';
import type { StrategyName } from './strategy';

/** engine/ordering.py HYBRID_SMALL_BALANCE_IN / _US. */
const HYBRID_SMALL: Record<string, number> = { IN: 50000, US: 1000 };

export function payoffOrders(user: UserPayload, marginalRate: string): Record<StrategyName, number[]> {
  const idx = user.loans.flatMap((l, i) => (isOpenCurrentLoan(l) ? [i] : []));
  const share = usMortgageShieldShare(user);
  const eff = new Map(
    idx.map((i) => [i, computeBreakdown(user.loans[i], marginalRate, user.country, user.tax_regime, share).effective.toNumber()]),
  );
  const bal = (i: number) => Number(user.loans[i].outstanding);
  const byRate = (a: number, b: number) => (eff.get(b) ?? 0) - (eff.get(a) ?? 0);
  const byBalance = (a: number, b: number) => bal(a) - bal(b);
  const small = HYBRID_SMALL[user.country] ?? HYBRID_SMALL.IN;
  return {
    avalanche: [...idx].sort(byRate),
    snowball: [...idx].sort(byBalance),
    hybrid: [...idx.filter((i) => bal(i) < small).sort(byBalance), ...idx.filter((i) => bal(i) >= small).sort(byRate)],
  };
}

/** The loans' names in the one order all three strategies share, or null
 *  when the strategies differ (or there's nothing to order). */
export function sharedPayoffOrder(user: UserPayload, marginalRate: string): string[] | null {
  const o = payoffOrders(user, marginalRate);
  const key = o.avalanche.join(',');
  if (o.avalanche.length === 0 || o.snowball.join(',') !== key || o.hybrid.join(',') !== key) return null;
  return o.avalanche.map((i) => {
    const l = user.loans[i];
    const type = LOAN_TYPE_NAME[l.loan_type];
    const bank = (l.bank ?? '').replace(/\s+bank$/i, '').trim();
    return bank ? `${bank} ${type}` : type.charAt(0).toUpperCase() + type.slice(1);
  });
}
