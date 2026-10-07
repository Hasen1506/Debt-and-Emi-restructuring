/**
 * Currency helpers shared between /plan, /debts, /tools and onboarding.
 *
 * Two ideas live here:
 *   1. Resolve the right currency for a loan — its explicit `currency` tag
 *      wins, otherwise the user-country default (USD for US, INR for IN).
 *   2. For the NRI-US hybrid case (loans in more than one currency), derive
 *      per-currency totals from the engine's per-loan payment trail so KPIs
 *      can render as separate INR / USD cards instead of a meaningless sum.
 */
import { formatCurrency, formatCurrencyWhole, type Country, type LoanPayload } from './api';
import type { MonthlyPaymentBreakdown } from '@/components/plan/PlanData';
import Decimal from 'decimal.js';

export type CurrencyCode = 'INR' | 'USD';

export function userDefaultCurrency(country: Country): CurrencyCode {
  return country === 'US' ? 'USD' : 'INR';
}

/** Currency symbol for inline labels (e.g. "Balance (₹)"). For full-number
 *  rendering use `formatCurrency` — this is just the one-char prefix. */
export function currencySymbol(currency: CurrencyCode): string {
  return currency === 'INR' ? '₹' : '$';
}

/** Convenience: prefix derived directly from country, when the caller doesn't
 *  already have a CurrencyCode in scope. */
export function countryCurrencySymbol(country: Country): string {
  return currencySymbol(userDefaultCurrency(country));
}

/** Each loan's display currency: explicit tag if present, else user default. */
export function loanCurrency(loan: LoanPayload, country: Country): CurrencyCode {
  return (loan.currency as CurrencyCode | undefined) ?? userDefaultCurrency(country);
}

/** The supported loan market follows its currency, independently of residence. */
export function loanMarket(loan: Pick<LoanPayload, 'currency'>, country: Country): Country {
  return loan.currency === 'INR' ? 'IN' : loan.currency === 'USD' ? 'US' : country;
}

/** A loan-currency amount in the user's currency at the given rates
 *  (loan-ccy → user-ccy). Null when the loan is foreign and no rate is
 *  known: the caller must not guess parity (₹20 lakh is not $20 lakh). */
export function loanToUser(
  amount: number,
  loan: LoanPayload,
  country: Country,
  fx: Record<string, string> | undefined,
): number | null {
  const lc = loanCurrency(loan, country);
  if (lc === userDefaultCurrency(country)) return amount;
  const r = Number(fx?.[lc]);
  return r > 0 ? amount * r : null;
}

/** Convert without rounding or guessing parity. Invalid FX suppresses advice. */
export function loanToUserDecimal(
  amount: Decimal.Value,
  loan: LoanPayload,
  country: Country,
  fx: Record<string, string> | undefined,
): Decimal | null {
  try {
    const value = new Decimal(amount);
    if (!value.isFinite()) return null;
    const lc = loanCurrency(loan, country);
    if (lc === userDefaultCurrency(country)) return value;
    const rate = new Decimal(fx?.[lc] ?? '0');
    return rate.isFinite() && rate.gt(0) ? value.mul(rate) : null;
  } catch {
    return null;
  }
}

/** One loan's amount in that loan's own currency (the engine reports each
 *  loan's payments and balance in it), with the user-currency figure
 *  alongside when the two differ: "₹4,80,000 (≈ $5,760)". */
export function formatLoanAmount(
  amount: number,
  loan: LoanPayload,
  country: Country,
  fx?: Record<string, string>,
): string {
  // The loan's own amount keeps its cents: rounding it to whole dollars
  // and printing ".00" showed $42,042.00 for $42,042.04, so a profile's
  // loan rows didn't add up to its Total (E2E golden journey, country switch).
  const own = formatCurrency(amount, loanCurrency(loan, country));
  if (loanCurrency(loan, country) === userDefaultCurrency(country)) return own;
  const user = loanToUser(amount, loan, country, fx);
  return user == null ? own : `${own} (≈ ${formatCurrencyWhole(user, userDefaultCurrency(country))})`;
}

/** Distinct currencies present in the loan list, ordered with the user-default
 *  first so the primary tab/card renders first in the UI. */
export function currenciesInPlay(
  loans: LoanPayload[],
  country: Country,
): CurrencyCode[] {
  const def = userDefaultCurrency(country);
  const set = new Set<CurrencyCode>();
  loans.forEach((l) => set.add(loanCurrency(l, country)));
  const list = Array.from(set);
  // Sort with default first, then alphabetic for determinism.
  list.sort((a, b) => {
    if (a === def) return -1;
    if (b === def) return 1;
    return a.localeCompare(b);
  });
  return list;
}

export interface PerCurrencyMetrics {
  /** Sum of scheduled EMIs across loans in this currency. */
  monthlyEmi: number;
  /** Sum of current outstanding balances across loans in this currency. */
  totalOutstanding: number;
  /** Total payments paid under the scenario, in this currency. */
  totalPaidScenario: number;
  /** Interest paid under the scenario = total paid − principal paid. */
  totalInterestScenario: number;
  /** Last simulated month with a non-zero payment in this currency (i.e.
   *  when the last loan in this currency clears). Null when the schedule
   *  never clears within the horizon. */
  debtFreeMonth: number | null;
  /** 0-based loan indices contributing to this currency. */
  loanIndices: number[];
}

/**
 * Walk the per-loan payment trail and produce per-currency aggregates.
 * Used by /plan to render INR / USD KPI cards for hybrid users without
 * any engine change — the engine returns per-loan amounts, we just
 * group them.
 *
 * Interest is derived as (total paid − principal reduction). Principal
 * reduction is (initial outstanding − final outstanding); we treat
 * `min(initial, totalPaid)` as the principal-reduction floor when a
 * loan clears inside the horizon (every excess payment over the
 * initial balance is interest). This is an approximation accurate to
 * the last fractional month's interest — good enough for headline KPIs.
 */
export function derivePerCurrencyMetrics(
  loans: LoanPayload[],
  monthlyPayments: MonthlyPaymentBreakdown[],
  country: Country,
): Record<CurrencyCode, PerCurrencyMetrics> {
  const out: Partial<Record<CurrencyCode, PerCurrencyMetrics>> = {};
  loans.forEach((loan, idx) => {
    const ccy = loanCurrency(loan, country);
    if (!out[ccy]) {
      out[ccy] = {
        monthlyEmi: 0,
        totalOutstanding: 0,
        totalPaidScenario: 0,
        totalInterestScenario: 0,
        debtFreeMonth: null,
        loanIndices: [],
      };
    }
    const bucket = out[ccy]!;
    bucket.loanIndices.push(idx);
    bucket.monthlyEmi += Number(loan.scheduled_emi) || 0;
    bucket.totalOutstanding += Number(loan.outstanding) || 0;
  });

  // Walk months in order to track last-paying-month per currency.
  for (const point of monthlyPayments) {
    for (const [idxStr, amountStr] of Object.entries(point.perLoan)) {
      const idx = Number(idxStr);
      const loan = loans[idx];
      if (!loan) continue;
      const amount = Number(amountStr) || 0;
      if (amount <= 0) continue;
      const ccy = loanCurrency(loan, country);
      const bucket = out[ccy]!;
      bucket.totalPaidScenario += amount;
      bucket.debtFreeMonth = point.month;
    }
  }

  // Now back out interest: (total paid − principal reduction).
  // Principal reduction is bounded by the initial outstanding — anything
  // paid beyond that is interest.
  for (const ccy of Object.keys(out) as CurrencyCode[]) {
    const bucket = out[ccy]!;
    const principalCleared = Math.min(bucket.totalPaidScenario, bucket.totalOutstanding);
    bucket.totalInterestScenario = Math.max(
      0,
      bucket.totalPaidScenario - principalCleared,
    );
  }

  return out as Record<CurrencyCode, PerCurrencyMetrics>;
}

/** Convenience: true when the loan list spans more than one currency. */
export function isHybridCurrency(loans: LoanPayload[], country: Country): boolean {
  return currenciesInPlay(loans, country).length > 1;
}

/**
 * Ensure `user.fx_to_user_currency` covers every non-default loan currency
 * present in the loan list, calling the FX endpoint for any missing entry.
 * Returns a new user payload with the dict populated; the existing entries
 * are preserved (so a user-supplied override sticks). Safe to call on
 * single-currency users — it's a no-op when there are no foreign loans.
 *
 * The engine treats a missing entry as parity (1.0), which silently
 * miscomputes the surplus for hybrid users; this helper closes that loop.
 *
 * Pass `cached` to seed from a cookie cache before deciding to refetch —
 * any rate present in the cached map *and* missing from the user object
 * is merged in, skipping the network round-trip. `onFetched` fires once
 * with the final rates if any new lookup happened (for cache persistence).
 */
export async function ensureFxRates<
  U extends { country: Country; loans: LoanPayload[]; fx_to_user_currency?: Record<string, string> },
>(
  user: U,
  fxRateLookup: (base: string, quote: string) => Promise<{ rate: string }>,
  options?: {
    cached?: Record<string, string>;
    onFetched?: (rates: Record<string, string>) => void;
  },
): Promise<U> {
  const userCcy = userDefaultCurrency(user.country);
  const needed = new Set<CurrencyCode>();
  for (const l of user.loans) {
    const lc = loanCurrency(l, user.country);
    if (lc !== userCcy) needed.add(lc);
  }
  if (needed.size === 0) return user;
  const existing = user.fx_to_user_currency ?? {};
  const cached = options?.cached ?? {};
  const updated: Record<string, string> = { ...existing };
  let fetchedAny = false;
  await Promise.all(
    Array.from(needed).map(async (ccy) => {
      if (updated[ccy] != null && updated[ccy] !== '') return;
      // Cached rate? Use it — same shape as a fresh fetch, no network call.
      if (cached[ccy] != null && cached[ccy] !== '') {
        updated[ccy] = cached[ccy];
        return;
      }
      try {
        const r = await fxRateLookup(ccy, userCcy);
        updated[ccy] = r.rate;
        fetchedAny = true;
      } catch {
        // Leave missing — engine falls back to parity with a known caveat
        // surfaced in the UI elsewhere. Better than crashing the page.
      }
    }),
  );
  if (fetchedAny && options?.onFetched) {
    options.onFetched(updated);
  }
  return { ...user, fx_to_user_currency: updated };
}
