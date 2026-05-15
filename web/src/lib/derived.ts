/**
 * Derived metrics computed client-side from a StoredProfile.
 *
 * Centralises the math that Home + Debts variants used to fake with
 * hardcoded constants. Same effective-APR formula as engine/formulas.py
 * (via lib/effective-apr.ts), same blending logic everywhere — toggle
 * themes and the numbers stay consistent.
 */
import Decimal from 'decimal.js';
import type { LoanPayload, Country, TaxRegimeIN } from './api';
import type { StoredProfile } from './user-store';
import { computeBreakdown } from './effective-apr';

export interface LoanWithEffective {
  loan: LoanPayload;
  nominal: Decimal;
  effective: Decimal;
  outstanding: Decimal;
  /** Index into profile.user.loans, for callers that want positional refs. */
  index: number;
}

export interface DerivedMetrics {
  loans: LoanWithEffective[];
  totalOutstanding: Decimal;
  blendedEffective: Decimal;
  emiBurden: Decimal;
  /** monthly_income − fixed_expenses − scheduled_emi total. May be negative. */
  surplus: Decimal;
  /** Loan with the highest effective APR (the "loudest" debt). null if no loans. */
  loudest: LoanWithEffective | null;
}

export function deriveMetrics(profile: StoredProfile): DerivedMetrics {
  const { user, marginalRate } = profile;
  const country: Country = user.country;
  const taxRegime: TaxRegimeIN | undefined = user.tax_regime;
  const rawLoans = user.loans ?? [];

  const loans: LoanWithEffective[] = rawLoans.map((loan, index) => {
    const { effective } = computeBreakdown(loan, marginalRate, country, taxRegime);
    return {
      loan,
      index,
      nominal: new Decimal(loan.nominal_rate || 0),
      effective,
      outstanding: new Decimal(loan.outstanding || 0),
    };
  });

  let totalOutstanding = new Decimal(0);
  let weightedEffSum = new Decimal(0);
  let emi = new Decimal(0);
  let loudest: LoanWithEffective | null = null;
  for (const l of loans) {
    totalOutstanding = totalOutstanding.add(l.outstanding);
    // Blended-APR numerator is Σ(balance × EFFECTIVE rate), not nominal.
    // Effective bakes in GST + processing fee + tax shield, so the blended
    // number reflects true cost of carrying the portfolio, not the headline
    // rates banks advertise. Verified against the engine's effective_rate.
    weightedEffSum = weightedEffSum.add(l.outstanding.mul(l.effective));
    emi = emi.add(new Decimal(l.loan.scheduled_emi || 0));
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
  const surplus = monthlyIncome.sub(fixed).sub(emi);

  return {
    loans,
    totalOutstanding,
    blendedEffective,
    emiBurden: emi,
    surplus,
    loudest,
  };
}
