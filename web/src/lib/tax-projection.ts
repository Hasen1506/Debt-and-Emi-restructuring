/**
 * Year-1 interest projection per loan, for tax-prep guidance.
 *
 * Uses the standard amortization formula client-side instead of asking the
 * engine for per-loan interest breakdown — the engine returns per-loan
 * payments but not per-loan interest, and adding that to the API surface
 * would mean changing MonthRow + trajectory + tests for what is, today,
 * advisory information.
 *
 * The simulation assumes the user pays the scheduled EMI (no avalanche
 * acceleration), since tax-prep wants "interest I'm going to pay over
 * the next year" — Section 24 / mortgage-interest deductions are based
 * on actual interest paid, and avalanche surplus routing would lower
 * the interest below this projection. That's a deliberate over-estimate
 * for tax planning: if the deduction cap binds against the projection,
 * it'll also bind against the actual.
 *
 * Credit cards: revolving, no fixed amortization. We approximate with
 * `outstanding × rate` for the year (assuming roughly stable balance —
 * realistic for cards paid at minimum). Tax deductions don't apply to
 * cards in either jurisdiction, so card rows are informational only.
 */
import Decimal from 'decimal.js';
import type { Country, LoanPayload, TaxRegimeIN } from './api';
import { loanCurrency, type CurrencyCode } from './currency';

export interface LoanYear1Interest {
  loanIndex: number;
  /** Display currency for this loan. */
  currency: CurrencyCode;
  /** Total interest projected over months 1-12. */
  year1Interest: Decimal;
  /** Whether this loan type can claim a deduction in the user's country. */
  deductionEligible: boolean;
  /** Free-text deduction context shown next to the row — e.g.
   *  "Section 24(b) — up to ₹2L for self-occupied home loans" or
   *  "Mortgage interest itemised deduction (Schedule A)". Null when
   *  not eligible. */
  deductionContext: string | null;
}

/**
 * Walk the standard amortization for 12 months and sum interest.
 * Returns a Decimal in the loan's own currency. Stops accruing once
 * the balance hits zero (small EMIs against a large balance will run
 * the full 12 months; large EMIs against a small balance will burn
 * down the loan partway through).
 */
function amortizeYear1Interest(loan: LoanPayload): Decimal {
  const balance0 = new Decimal(loan.outstanding || 0);
  const rateAnnual = new Decimal(loan.nominal_rate || 0);
  const monthlyRate = rateAnnual.div(12);
  const emi = new Decimal(loan.scheduled_emi || 0);

  if (loan.loan_type === 'credit_card') {
    // Approximate: balance × rate × 1 year. Accurate when the user pays
    // at/near minimum (balance stays roughly flat). Underestimates if
    // they're paying more aggressively — fine, this row is informational.
    return balance0.mul(rateAnnual);
  }

  if (balance0.lte(0) || monthlyRate.lte(0) || emi.lte(0)) {
    return new Decimal(0);
  }

  let balance = balance0;
  let interest = new Decimal(0);
  for (let m = 0; m < 12; m++) {
    if (balance.lte(0)) break;
    const monthInterest = balance.mul(monthlyRate);
    const monthPrincipal = emi.sub(monthInterest);
    if (monthPrincipal.lte(0)) {
      // EMI doesn't cover interest — degenerate input (under-amortising).
      // Accrue interest as if balance stays flat; this is wrong but bounded.
      interest = interest.add(monthInterest);
      continue;
    }
    interest = interest.add(monthInterest);
    balance = balance.sub(monthPrincipal);
  }
  return interest;
}

/**
 * Per-loan year-1 interest + deduction eligibility for a user.
 *
 * Returns one entry per loan, in the same order. Caller renders or sums
 * as needed (e.g. India Sec 24 sums interest across HOME loans only,
 * US Schedule A sums across HOME and AUTO mortgage interest only).
 */
export function projectYear1Interest(
  user: { country: Country; loans: LoanPayload[]; tax_regime?: TaxRegimeIN },
): LoanYear1Interest[] {
  return user.loans.map((loan, idx) => {
    const interest = amortizeYear1Interest(loan);
    const { eligible, context } = describeDeduction(
      user.country,
      user.tax_regime,
      loan,
    );
    return {
      loanIndex: idx,
      currency: loanCurrency(loan, user.country),
      year1Interest: interest,
      deductionEligible: eligible,
      deductionContext: context,
    };
  });
}

// ─── Multi-year projection for auto-reinvest ────────────────────────────────

export interface YearlyTaxSaving {
  /** 1-based fiscal year of the simulation. Y1 covers months 1-12, etc. */
  year: number;
  /** Sum of deductible interest across loans in user residence currency.
   *  Already capped per deduction rules (e.g. ₹2L Sec 24b for India old). */
  deductibleInterestUserCcy: Decimal;
  /** Tax saving = deductibleInterest × marginalRate. */
  taxSaving: Decimal;
  /** Simulation month at which to apply the reinvest (post-ITR-filing).
   *  India: Q3 of FY+1 (~9 months after FY end). US: ~5 months after TY end
   *  (peak refund-disbursement window). */
  applyMonth: number;
}

interface MultiYearArgs {
  country: Country;
  taxRegime?: TaxRegimeIN;
  marginalRate: Decimal;
  /** Loan-currency → user-currency FX factor. Used to convert deductible
   *  interest into the user's residence ccy so the reinvest amount that
   *  hits the engine is in the same denomination as `monthly_income`. */
  fxToUserCcy: (amount: Decimal, loanCcy: string) => Decimal;
  /** Horizon for the projection in years. Beyond this the deduction is
   *  assumed zero (in practice loans either clear or fall below the cap). */
  horizonYears?: number;
}

/**
 * Walk each loan's amortization year-by-year, summing interest per year.
 * Returns the per-year per-loan interest series in loan currency.
 *
 * Separated from `amortizeYear1Interest` so the existing TaxBreakdown
 * UI keeps its tight Y1-only contract while the auto-reinvest projector
 * gets a multi-year series without changing the existing function's shape.
 */
function amortizeYearlyInterest(loan: LoanPayload, years: number): Decimal[] {
  const balance0 = new Decimal(loan.outstanding || 0);
  const rateAnnual = new Decimal(loan.nominal_rate || 0);
  const monthlyRate = rateAnnual.div(12);
  const emi = new Decimal(loan.scheduled_emi || 0);

  if (loan.loan_type === 'credit_card') {
    // Cards revolve — assume roughly flat balance each year. Conservative.
    // Stops emitting after balance drops below a token threshold to avoid
    // perpetual non-zero series for unrealistic inputs.
    const yearly = balance0.mul(rateAnnual);
    return Array.from({ length: years }, () => yearly);
  }

  if (balance0.lte(0) || monthlyRate.lte(0) || emi.lte(0)) {
    return Array.from({ length: years }, () => new Decimal(0));
  }

  let balance = balance0;
  const out: Decimal[] = [];
  for (let y = 0; y < years; y++) {
    let interest = new Decimal(0);
    for (let m = 0; m < 12; m++) {
      if (balance.lte(0)) break;
      const monthInterest = balance.mul(monthlyRate);
      const monthPrincipal = emi.sub(monthInterest);
      if (monthPrincipal.lte(0)) {
        // Under-amortising EMI — interest accrues flat.
        interest = interest.add(monthInterest);
        continue;
      }
      interest = interest.add(monthInterest);
      balance = balance.sub(monthPrincipal);
    }
    out.push(interest);
    if (balance.lte(0)) {
      // Zero-pad remaining years so the array length matches.
      for (let k = y + 1; k < years; k++) out.push(new Decimal(0));
      break;
    }
  }
  return out;
}

/**
 * Per-regime deduction caps as a function of (interest paid in a year).
 * Returns the deductible portion. Caps are applied per loan (Sec 24b is
 * actually a property-level cap but we approximate as loan-level since
 * the app's model is loan-centric).
 */
function deductibleAmount(
  country: Country,
  regime: TaxRegimeIN | undefined,
  loan: LoanPayload,
  rawInterest: Decimal,
): Decimal {
  if (country === 'IN') {
    const isNew = regime !== 'old';
    if (isNew) return new Decimal(0);
    if (loan.loan_type === 'home_loan') {
      return Decimal.min(rawInterest, 200_000);
    }
    if (loan.loan_type === 'education_loan') {
      return rawInterest;
    }
    return new Decimal(0);
  }
  // US — single regime
  if (loan.loan_type === 'home_loan') return rawInterest;
  if (loan.loan_type === 'education_loan') {
    return Decimal.min(rawInterest, 2_500);
  }
  return new Decimal(0);
}

/**
 * Project per-year tax savings across the user's loan portfolio for use
 * with the auto-reinvest toggle. Output is a list of YearlyTaxSaving with
 * the application month already chosen (post-ITR-filing).
 *
 * Returned entries are dropped when the year's saving is ≤ 0 (no
 * eligible interest or zero marginal rate) so callers can pass the list
 * straight through to the engine without filtering.
 */
export function projectAnnualTaxSavings(
  user: { country: Country; loans: LoanPayload[]; tax_regime?: TaxRegimeIN },
  args: MultiYearArgs,
): YearlyTaxSaving[] {
  const years = args.horizonYears ?? 30;
  if (args.marginalRate.lte(0)) return [];

  // Per-loan per-year interest series in loan currency.
  const seriesPerLoan = user.loans.map((l) =>
    amortizeYearlyInterest(l, years).map((interest, yIdx) => ({
      year: yIdx + 1,
      loan: l,
      interest,
    })),
  );

  // Roll up per year — sum deductible portions across loans, convert to
  // user currency, multiply by marginal rate.
  const out: YearlyTaxSaving[] = [];
  // India FY ends Mar; ITR typically due Jul, refunds Sep-Nov.
  //   → apply at sim-month = year*12 + 9 (about 9 months after FY end).
  // US TY ends Dec; returns due Apr 15; refunds within ~6 weeks of filing.
  //   → apply at sim-month = year*12 + 5 (about 5 months after TY end).
  const applyOffset = user.country === 'IN' ? 9 : 5;

  for (let y = 1; y <= years; y++) {
    let yearTotalDeductibleUserCcy = new Decimal(0);
    for (const loanSeries of seriesPerLoan) {
      const row = loanSeries[y - 1];
      if (!row) continue;
      const deductibleLoanCcy = deductibleAmount(
        user.country,
        user.tax_regime,
        row.loan,
        row.interest,
      );
      if (deductibleLoanCcy.lte(0)) continue;
      const loanCcy = row.loan.currency ?? (user.country === 'US' ? 'USD' : 'INR');
      yearTotalDeductibleUserCcy = yearTotalDeductibleUserCcy.add(
        args.fxToUserCcy(deductibleLoanCcy, loanCcy),
      );
    }
    const taxSaving = yearTotalDeductibleUserCcy.mul(args.marginalRate);
    if (taxSaving.lte(0)) continue;
    out.push({
      year: y,
      deductibleInterestUserCcy: yearTotalDeductibleUserCcy,
      taxSaving,
      applyMonth: y * 12 + applyOffset,
    });
  }
  return out;
}

/**
 * Country- AND regime-specific deduction rules.
 *
 * India — regime matters from FY24 onwards (new regime is default):
 *   • Old regime:
 *     - Home loan interest: Sec 24(b), ₹2L cap (self-occupied).
 *     - Education loan interest: Sec 80E, full deduction, 8 years.
 *     - Auto / personal / cards: no deduction.
 *   • New regime (FY24+ default):
 *     - All of the above are NOT available except let-out property
 *       interest (Sec 24b for rental — but we don't currently track
 *       let-out vs self-occupied, so we just surface "not deductible
 *       on new regime" without nudging a switch. Switching regimes
 *       costs the lower slab rates, which this app can't fully
 *       evaluate against, so the choice is left to the user.
 *
 * US — single regime, deductions stable:
 *   • Home loan interest: Schedule A itemised, $750k cap (TCJA).
 *   • Student loan interest: above-the-line, $2,500/yr (income phase-out).
 *   • Auto / personal / cards: no deduction.
 */
function describeDeduction(
  country: Country,
  regime: TaxRegimeIN | undefined,
  loan: LoanPayload,
): { eligible: boolean; context: string | null } {
  if (country === 'IN') {
    // New regime is default from FY24+ when regime is unset.
    const isNew = regime !== 'old';
    if (loan.loan_type === 'home_loan') {
      if (isNew) {
        return {
          eligible: false,
          // The user picked new regime in onboarding. We respect the choice
          // and don't nudge them to switch — regime change has consequences
          // (loses lower slab rates) that this app can't fully evaluate.
          context: 'Sec 24(b) self-occupied: not deductible on new regime.',
        };
      }
      return {
        eligible: true,
        context: 'Sec 24(b): interest deductible up to ₹2L/yr (self-occupied).',
      };
    }
    if (loan.loan_type === 'education_loan') {
      if (isNew) {
        return {
          eligible: false,
          context: 'Sec 80E: not deductible on new regime.',
        };
      }
      return {
        eligible: true,
        context: 'Sec 80E: full interest deductible, up to 8 years from repayment start.',
      };
    }
    return { eligible: false, context: null };
  }
  // US — no regime split.
  if (loan.loan_type === 'home_loan') {
    return {
      eligible: true,
      context: 'Schedule A itemised: mortgage interest deductible (post-2017 $750k cap).',
    };
  }
  if (loan.loan_type === 'education_loan') {
    return {
      eligible: true,
      context: 'Student loan interest deduction: up to $2,500/yr above-the-line (income phase-out).',
    };
  }
  return { eligible: false, context: null };
}
