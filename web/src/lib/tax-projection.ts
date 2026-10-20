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
import type { Country, DeductionsPayload, FilingStatusUS, LoanPayload, TaxRegimeIN } from './api';
import { pickUSDeduction } from './deductions';
import type { CurrencyCode } from './currency';
import { preConstructionInstalment, sec80eMonthsLeft, taxShare } from './india-tax-loans';
import { letOutRoom } from './marginal-cost';
import TAX from './tax-tables.json';
import { yearlyInterest } from '@/lib/amortization';
import { fullCap24, taxType } from '@/lib/loan-types';

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
  /** 'YYYY-MM' today, for the India calendar rules (80E window,
   *  pre-construction instalments). Omitted: the engine fields on the loan. */
  currentMonth?: string;
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
  // Shared walk: the last month pays only the balance plus that month's
  // interest, so a small balance and a large EMI cannot drive the balance
  // negative and invent a later month of interest.
  return yearlyInterest(loan, years);
}

/**
 * Deductible interest for one year of an Indian loan portfolio (sprint G2,
 * Income-tax Act 2025; 1961 numbers in brackets). Caps are per taxpayer,
 * not per loan: self-occupied homes share one ₹2L (s.22(2), (5) [24(b)]),
 * each on the user's share (co-borrower) plus this year's pre-construction
 * instalment (s.22(1)(c)); a let-out home is limited to its rent after 30%
 * plus what's left of the old regime's ₹2L set-off (s.22(1)(a), s.109(1)(b));
 * an education loan counts only inside its 8-tax-year window (s.129 [80E]).
 * New regime: only a let-out home's interest against its rent (s.202).
 * The year index counts from today; `yearInterest[i]` is loan i's interest.
 */
export function indiaDeductibleForYear(
  regime: TaxRegimeIN | undefined,
  loans: LoanPayload[],
  yearInterest: Decimal[],
  year: number,
  currentMonth?: string,
): Decimal {
  const isOld = regime === 'old';
  let soClaim = new Decimal(0);
  let soCap = new Decimal(0);
  let anySo = false;
  let allFull = true;
  let soCapSum = new Decimal(0);
  let other = new Decimal(0);
  const letOut: Array<{ claim: Decimal; loan: LoanPayload }> = [];
  loans.forEach((loan, i) => {
    const interest = yearInterest[i] ?? new Decimal(0);
    const share = taxShare(loan);
    if (taxType(loan) === 'home_loan') {
      // The instalment runs for the five tax years from completion; year 1
      // is this tax year (approximately: plan years start this month).
      const month = currentMonth ? addYears(currentMonth, year - 1) : undefined;
      const inst = month ? preConstructionInstalment(loan, month) : new Decimal(loan.pre_construction_interest_annual || 0).mul(year === 1 ? 1 : 0);
      const claim = interest.add(inst).mul(share);
      if (claim.lte(0)) return;
      if (loan.property_use === 'let_out') {
        letOut.push({ claim, loan });
      } else {
        anySo = true;
        soClaim = soClaim.add(claim);
        const full = fullCap24(loan);
        allFull = allFull && full;
        soCapSum = soCapSum.add(full ? TAX.in.deductions.sec24b_self_occupied_cap : TAX.in.deductions.sec24b_other_cap);
      }
    } else if (loan.loan_type === 'education_loan' && isOld) {
      const left = currentMonth ? sec80eMonthsLeft(loan.edu_interest_start, currentMonth) : loan.tax_deduction_months_left ?? null;
      // The window closes at a 31 March; count the year if any of it is open.
      if (left != null && left <= (year - 1) * 12) return;
      other = other.add(interest.mul(share));
    }
  });
  if (isOld && anySo) {
    soCap = allFull
      ? new Decimal(TAX.in.deductions.sec24b_self_occupied_cap)
      : Decimal.min(TAX.in.deductions.sec24b_self_occupied_cap, soCapSum);
  }
  const soDeduction = Decimal.min(soClaim, soCap);
  let total = soDeduction.add(other);
  let setOffUsed = soDeduction;
  for (const { claim, loan } of letOut) {
    const room = letOutRoom(regime ?? 'new', loan.annual_rent, taxShare(loan), setOffUsed);
    const got = Decimal.min(claim, room);
    // What went past the rent used up set-off.
    const rentPart = letOutRoom(regime ?? 'new', loan.annual_rent, taxShare(loan), new Decimal(TAX.in.deductions.hp_loss_set_off_cap));
    setOffUsed = setOffUsed.add(Decimal.max(0, got.sub(rentPart)));
    total = total.add(got);
  }
  return total;
}

function addYears(month: string, years: number): string {
  const [y, m] = month.split('-').map(Number);
  return `${y + years}-${String(m).padStart(2, '0')}`;
}

function deductibleAmountUS(loan: LoanPayload, rawInterest: Decimal): Decimal {
  if (taxType(loan) === 'home_loan') return rawInterest;
  if (loan.loan_type === 'education_loan') return rawInterest; // the $2,500 cap is per return, applied below
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
  user: {
    country: Country;
    loans: LoanPayload[];
    tax_regime?: TaxRegimeIN;
    filing_status?: FilingStatusUS;
    deductions?: DeductionsPayload;
  },
  args: MultiYearArgs,
): YearlyTaxSaving[] {
  // US: mortgage interest only saves tax where itemised deductions pass the
  // standard deduction, and only on the part above it.
  const usStandard = pickUSDeduction(undefined, user.filing_status).standard;
  const usOther = new Decimal(user.deductions?.itemized_deductions_other || 0);
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
    let usMortgageUserCcy = new Decimal(0);
    let usEduUserCcy = new Decimal(0);
    if (user.country === 'IN') {
      // INR loans only: the deduction caps are in rupees (an NRI's US loan
      // gets no Indian deduction).
      const inr = user.loans.map((l, i) => ({ l, i })).filter(({ l }) => (l.currency ?? 'INR') === 'INR');
      const ded = indiaDeductibleForYear(
        user.tax_regime,
        inr.map(({ l }) => l),
        inr.map(({ i }) => seriesPerLoan[i][y - 1]?.interest ?? new Decimal(0)),
        y,
        args.currentMonth,
      );
      const taxSaving = ded.mul(args.marginalRate);
      if (taxSaving.gt(0)) out.push({ year: y, deductibleInterestUserCcy: ded, taxSaving, applyMonth: y * 12 + applyOffset });
      continue;
    }
    for (const loanSeries of seriesPerLoan) {
      const row = loanSeries[y - 1];
      if (!row) continue;
      const deductibleLoanCcy = deductibleAmountUS(
        row.loan,
        row.interest,
      );
      if (deductibleLoanCcy.lte(0)) continue;
      const loanCcy = row.loan.currency ?? (user.country === 'US' ? 'USD' : 'INR');
      const inUserCcy = args.fxToUserCcy(deductibleLoanCcy, loanCcy);
      if (user.country === 'US' && taxType(row.loan) === 'home_loan') {
        usMortgageUserCcy = usMortgageUserCcy.add(inUserCcy);
      } else if (row.loan.loan_type === 'education_loan') {
        usEduUserCcy = usEduUserCcy.add(inUserCcy);
      } else {
        yearTotalDeductibleUserCcy = yearTotalDeductibleUserCcy.add(inUserCcy);
      }
    }
    // Student-loan interest: $2,500 per return, not per loan.
    yearTotalDeductibleUserCcy = yearTotalDeductibleUserCcy.add(Decimal.min(usEduUserCcy, 2_500));
    if (usMortgageUserCcy.gt(0)) {
      const above = usMortgageUserCcy.add(usOther).sub(usStandard);
      yearTotalDeductibleUserCcy = yearTotalDeductibleUserCcy.add(
        Decimal.max(0, Decimal.min(usMortgageUserCcy, above)),
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
