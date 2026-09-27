/**
 * Derived metrics computed client-side from a StoredProfile.
 *
 * Centralises the math that Home + Debts variants used to fake with
 * hardcoded constants. Same effective-APR formula as engine/formulas.py
 * (via lib/effective-apr.ts), same blending logic everywhere — toggle
 * themes and the numbers stay consistent.
 */
import { dec } from './safe-decimal';
import Decimal from 'decimal.js';
import type { LoanPayload, Country, TaxRegimeIN } from './api';
import type { StoredProfile } from './user-store';
import { computeBreakdown } from './effective-apr';
import { usMortgageShieldShare } from './deductions';
import { loanCurrency, userDefaultCurrency, type CurrencyCode } from './currency';
import { requiredMonthly } from './min-payment';

export interface LoanWithEffective {
  loan: LoanPayload;
  nominal: Decimal;
  effective: Decimal;
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
  /** Loan with the highest effective APR (the "loudest" debt). null if no loans. */
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
  const taxRegime: TaxRegimeIN | undefined = user.tax_regime;
  const itemises = usMortgageShieldShare(user);
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
  const loans: LoanWithEffective[] = rawLoans
    .map((loan, index) => {
      const { effective } = computeBreakdown(loan, marginalRate, country, taxRegime, itemises);
      return {
        loan,
        index,
        nominal: new Decimal(loan.nominal_rate || 0),
        effective,
        outstanding: dec(loan.outstanding),
        required: requiredMonthly(loan, country),
      };
    })
    .filter((l) => l.outstanding.gt(0));

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
    // Blended-APR numerator is Σ(balance × EFFECTIVE rate), not nominal.
    // Effective bakes in GST + processing fee + tax shield, so the blended
    // number reflects true cost of carrying the portfolio, not the headline
    // rates banks advertise. Verified against the engine's effective_rate.
    weightedEffSum = weightedEffSum.add(outUser.mul(l.effective));
    emi = emi.add(emiUser);
    if (l.outstanding.gt(0) && (loudest == null || l.effective.gt(loudest.effective))) {
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

  const monthlyIncome = new Decimal(user.monthly_income || 0);
  const fixed = new Decimal(user.fixed_expenses || 0);
  const variable = new Decimal(user.variable_expenses || 0);
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
  const P = new Decimal(outstanding || 0);
  const annualR = new Decimal(nominalAnnualRate || 0);
  const E = new Decimal(emi || 0);
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
