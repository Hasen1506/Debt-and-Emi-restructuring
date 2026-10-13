/**
 * Derived metrics computed client-side from a StoredProfile.
 *
 * Centralises the math that Home + Debts variants used to fake with
 * hardcoded constants. A loan's rate is what it costs a year from here
 * (lib/marginal-cost, the engine's MarginalCost.annual_cost): the same
 * figure on every page, and the one the payoff order ranks by.
 */
import { dec } from './safe-decimal';
import Decimal from 'decimal.js';
// Typed values can be blank, half typed ("25 la") or NaN; dec() reads them
// as 0 instead of throwing a DecimalError (live re-test NEW-1).
import { dec as safeDecimal } from './safe-decimal';
import type { LoanPayload, Country } from './api';
import type { StoredProfile } from './user-store';
import { marginalCost, userMarginalCosts, type MarginalCost } from './marginal-cost';
import { loanCurrency, userDefaultCurrency, type CurrencyCode } from './currency';
import { requiredMonthly } from './min-payment';
import { prepareLoanPaymentTiming } from './roll-forward';
import { countryMonthKey } from './today';

export interface LoanWithEffective {
  loan: LoanPayload;
  nominal: Decimal;
  /** What the loan costs a year from here: interest compounded monthly, plus
   *  GST on a card, less the tax break at the margin (lib/marginal-cost,
   *  the engine's annual_cost). The one rate shown for a loan. */
  effective: Decimal;
  /** Its parts, and `orderKey` for the payoff order. */
  cost: MarginalCost;
  outstanding: Decimal;
  /** What the bank requires this month, in the loan's currency: the EMI,
   *  or a card's minimum payment. */
  required: Decimal;
  /** Index into profile.user.loans, for callers that want positional refs. */
  index: number;
}

export interface DerivedMetrics {
  loans: LoanWithEffective[];
  totalOutstanding: Decimal;
  blendedEffective: Decimal;
  /** EMIs plus card minimums, in the user's currency. */
  emiBurden: Decimal;
  /** monthly_income − fixed_expenses − variable_expenses − emiBurden. May be
   *  negative: then −surplus is how far income falls short of costs plus
   *  minimum payments. Mirrors the engine's compute_available_surplus
   *  (before its floor at 0 and the emergency-fund top-up). */
  surplus: Decimal;
  /** The loan an extra payment goes to first by cost: the top of the
   *  avalanche order (prepayment fee and lock-in counted). null if none. */
  loudest: LoanWithEffective | null;
  /** This month's interest across open loans (balance × nominal ÷ 12), in
   *  the user's currency. */
  monthlyInterest: Decimal;
  /** A loan-currency amount in the user's currency (FX map, parity if none). */
  toUserCcy: (amount: Decimal, loan: LoanPayload) => Decimal;
  /** Currencies of open loans with no exchange rate saved. The totals and
   *  surplus above took those loans at parity, so they mean nothing: pages
   *  ask for the rate instead of showing them. */
  fxMissing: CurrencyCode[];
}

export function deriveMetrics(profile: StoredProfile): DerivedMetrics {
  const { user, marginalRate } = profile;
  const country: Country = user.country;
  const rawLoans = user.loans ?? [];
  const userCcy = userDefaultCurrency(country);
  const fxMap = user.fx_to_user_currency ?? {};
  // Multiply a loan-currency amount by the right FX factor to express it
  // in the user's residence currency. Parity for matching currencies.
  const fxMissing = new Set<CurrencyCode>();
  const toUserCcy = (amount: Decimal, loan: LoanPayload): Decimal => {
    const lc = loanCurrency(loan, country);
    if (lc === userCcy) return amount;
    const rate = dec(fxMap[lc]);
    if (rate.lte(0)) {
      fxMissing.add(lc);
      return amount;
    }
    return amount.mul(rate);
  };

  // Open loans only: a loan paid down to 0 has no EMI left and isn't a
  // debt. Counting it crashed home and /debts when every loan was paid off
  // (no "loudest" loan) and took its old EMI out of the surplus. `index`
  // stays the position in user.loans.
  const costs = userMarginalCosts(user, marginalRate);
  const loans: LoanWithEffective[] = rawLoans
    .map((loan, index) => {
      // Paid-off loans aren't costed (and are dropped just below).
      const cost = costs.get(index) ?? marginalCost(loan.nominal_rate || 0, false, 0, 0, 0);
      return {
        loan,
        index,
        nominal: safeDecimal(loan.nominal_rate),
        effective: cost.annualCost,
        cost,
        outstanding: dec(loan.outstanding),
        required: requiredMonthly(loan, country),
      };
    })
    .filter((l) => l.outstanding.gt(0) && (l.loan.planned_effective_month ?? 1) <= 1);

  let totalOutstanding = new Decimal(0);
  let weightedEffSum = new Decimal(0);
  let emi = new Decimal(0);
  let monthlyInterest = new Decimal(0);
  let loudest: LoanWithEffective | null = null;
  for (const l of loans) {
    monthlyInterest = monthlyInterest.add(toUserCcy(l.outstanding.mul(l.nominal).div(12), l.loan));
    // Both outstanding and EMI need conversion before summing — totals
    // were silently mixing INR and USD for hybrid users before this.
    const outUser = toUserCcy(l.outstanding, l.loan);
    const emiUser = toUserCcy(l.required, l.loan);
    totalOutstanding = totalOutstanding.add(outUser);
    // Σ(balance × what each loan costs a year), not the statement rates:
    // compounding, GST and the tax break are in, as on each loan's row.
    weightedEffSum = weightedEffSum.add(outUser.mul(l.effective));
    emi = emi.add(emiUser);
    if (l.outstanding.gt(0) && (loudest == null || l.cost.orderKey.gt(loudest.cost.orderKey))) {
      loudest = l;
    }
  }

  // Balance-weighted average: a ₹40L home loan at 8% effective swamps a ₹1L
  // card at 40% effective in the blended number — that's intentional, since
  // the blended figure answers "what rate is my overall debt costing me?",
  // not "where's my highest pain point?" (the `loudest` field is for that).
  const blendedEffective = totalOutstanding.gt(0)
    ? weightedEffSum.div(totalOutstanding)
    : new Decimal(0);

  const monthlyIncome = safeDecimal(user.monthly_income);
  const fixed = safeDecimal(user.fixed_expenses);
  const variable = safeDecimal(user.variable_expenses);
  const surplus = monthlyIncome.sub(fixed).sub(variable).sub(emi);

  return {
    loans,
    totalOutstanding,
    blendedEffective,
    emiBurden: emi,
    surplus,
    loudest,
    monthlyInterest,
    toUserCcy,
    fxMissing: Array.from(fxMissing),
  };
}

/** Home's current-month cash flow, separate from recurring commitments.
 * A newly borrowed loan is still owed, but its EMI starts next month. */
export function cashFlowForMonth(
  profile: StoredProfile, metrics: DerivedMetrics, month = countryMonthKey(profile.user.country),
): { emiBurden: Decimal; surplus: Decimal } {
  const loans = prepareLoanPaymentTiming(profile.user.loans ?? [], month);
  const emiBurden = metrics.loans.reduce((sum, row) => {
    if ((loans[row.index]?.first_payment_month ?? 1) > 1) return sum;
    return sum.add(metrics.toUserCcy(row.required, row.loan));
  }, new Decimal(0));
  return {
    emiBurden,
    surplus: dec(profile.user.monthly_income).sub(dec(profile.user.fixed_expenses))
      .sub(dec(profile.user.variable_expenses)).sub(emiBurden),
  };
}

/**
 * Months left to pay off a loan at the given EMI, derived from the
 * standard amortisation formula:
 *
 *   n = −log(1 − r·P/EMI) / log(1 + r)
 *
 * where `r` is the monthly rate (annual rate / 12) and `P` is current
 * outstanding. Returned value is the integer ceiling of n (the last
 * partial-month rolls into a full month for display).
 *
 * Most users know their outstanding, EMI, and rate but can't recite
 * tenure-remaining. This helper lets onboarding *compute* the answer
 * for them and surface it as feedback instead of asking.
 *
 * Returns null when:
 *   - inputs are non-positive,
 *   - the EMI doesn't even cover monthly interest (never amortises),
 *   - the inputs imply tenure > 600 months (50 yrs — almost certainly a typo).
 */
export function deriveTenureMonths(
  outstanding: number | string | Decimal,
  nominalAnnualRate: number | string | Decimal,
  emi: number | string | Decimal,
): number | null {
  const P = safeDecimal(outstanding);
  const annualR = safeDecimal(nominalAnnualRate);
  const E = safeDecimal(emi);
  if (P.lte(0) || E.lte(0)) return null;
  if (annualR.lte(0)) {
    // Zero-interest loan: pure division.
    const months = P.div(E).toNumber();
    return Math.max(1, Math.ceil(months));
  }
  const r = annualR.div(12);
  const monthlyInterest = P.mul(r);
  if (E.lte(monthlyInterest)) {
    // EMI < interest accrued each month → balance grows forever.
    return null;
  }
  // ln(1 - rP/E) is negative; dividing by ln(1+r) (positive) gives a negative;
  // negate to get months. Use plain JS Math.log on .toNumber() — Decimal has
  // no log.
  const ratio = new Decimal(1).sub(r.mul(P).div(E));
  const n = -Math.log(ratio.toNumber()) / Math.log(1 + r.toNumber());
  if (!Number.isFinite(n) || n <= 0 || n > 600) return null;
  return Math.ceil(n);
}

