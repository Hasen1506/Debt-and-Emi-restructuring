/**
 * The Tax page's reading of a profile (sprint G2; grill #20, #32).
 *
 * Income mix (#20): a tax bracket is only as good as the income it's worked
 * out from. People are salaried, salaried with a side business, or run a
 * business alone, and each is taxed a little differently: the standard
 * deduction is for salary only (s.19 of the Income-tax Act 2025, 1961
 * s.16(ia)); business income changes how often you may switch regime
 * (s.202(4)). Profile's income streams already hold the mix; without them
 * the gross fields do; without those the rate is an estimate from take-home
 * pay and is labelled as one until the user confirms it.
 */
import Decimal from 'decimal.js';
import type { LoanPayload, UserPayload } from './api';
import { activeStreams, streamSlabContribution } from './income-streams';
import { nextYearSplit, sec80eMonthsLeft, taxShare } from './india-tax-loans';
import type { HomeLoanYear, OldAge, RegimeInputs } from './regime-compare';

const D = (v: Decimal.Value | null | undefined) => new Decimal(v == null || v === '' ? 0 : v);

export type IncomeMix = 'salary' | 'salary_plus_business' | 'business' | 'unknown';

export interface IncomeReading {
  mix: IncomeMix;
  salary: Decimal;
  business: Decimal;
  other: Decimal;
  /** Where the numbers came from. */
  source: 'streams' | 'gross' | 'none';
}

/** Salary, business and other slab-taxed income for the year. */
export function readIncome(user: UserPayload, asOf: Date = new Date()): IncomeReading {
  const streams = activeStreams(user.income_streams, asOf);
  if (streams.length > 0) {
    let salary = new Decimal(0);
    let business = new Decimal(0);
    let other = new Decimal(0);
    for (const s of streams) {
      const v = streamSlabContribution(s);
      if (s.kind === 'salaried') salary = salary.add(v);
      else if (s.kind === 'business_owner' || s.kind === 'freelance') business = business.add(v);
      else other = other.add(v);
    }
    return { mix: mixOf(salary, business), salary, business, other, source: 'streams' };
  }
  const salary = D(user.annual_gross_salary);
  const business = D(user.annual_business_income);
  if (salary.gt(0) || business.gt(0)) return { mix: mixOf(salary, business), salary, business, other: new Decimal(0), source: 'gross' };
  // Live re-test 2 R2-7: Setup's "How you earn" (Salaried is pre-selected
  // and saved as income_type) still says how they earn, with no amounts.
  const fromSetup: IncomeMix =
    user.income_type === 'salaried' ? 'salary' : user.income_type === 'business_owner' ? 'business' : 'unknown';
  return { mix: fromSetup, salary: new Decimal(0), business: new Decimal(0), other: new Decimal(0), source: 'none' };
}

function mixOf(salary: Decimal, business: Decimal): IncomeMix {
  if (salary.gt(0) && business.gt(0)) return 'salary_plus_business';
  if (business.gt(0)) return 'business';
  if (salary.gt(0)) return 'salary';
  return 'unknown';
}

export const MIX_LABEL: Record<IncomeMix, string> = {
  salary: 'Salary only',
  salary_plus_business: 'Salary and a side business',
  business: 'Business or profession only',
  unknown: 'Not given yet',
};

/** Is the plan's tax rate worked out from gross income, or estimated from
 *  take-home pay? An estimate the user hasn't confirmed is labelled so
 *  wherever it can change the advice. */
export function taxRateStatus(user: UserPayload): 'from_income' | 'confirmed' | 'estimated' {
  if (readIncome(user).source !== 'none') return 'from_income';
  return user.tax_rate_confirmed ? 'confirmed' : 'estimated';
}

/** Old-regime age table from the profile's age bracket. '60_plus' can't tell
 *  60-79 from 80+; it gets the 60-79 table (the 80+ one is kinder, so this
 *  never understates old-regime tax). */
export function oldRegimeAge(user: UserPayload): OldAge {
  return user.age_bracket === '60_plus' ? '60_79' : undefined;
}

/** The scheduled-year figures for each Indian home loan, in the shape the
 *  regime comparison takes. */
export function homeLoanYears(loans: LoanPayload[], currentMonth: string): HomeLoanYear[] {
  return loans
    .filter((l) => l.loan_type === 'home_loan' && (l.currency ?? 'INR') === 'INR' && D(l.outstanding).gt(0))
    .map((l) => {
      const { interest, principal } = nextYearSplit(l);
      return {
        interest,
        principal,
        share: taxShare(l),
        letOut: l.property_use === 'let_out',
        annualRent: l.annual_rent ? D(l.annual_rent) : null,
        preConstructionInstalment: D(l.pre_construction_interest_annual),
        fullCap: l.sec24_full_cap !== false,
        principal80cEligible: l.principal_80c_eligible !== false,
      };
    });
}

/** The user's share of next year's education-loan interest that falls inside
 *  the s.129 [80E] window (pro rata when the window ends within the year). */
export function eduInterestInWindow(loans: LoanPayload[], currentMonth: string): { amount: Decimal; anyLoan: boolean } {
  let amount = new Decimal(0);
  let anyLoan = false;
  for (const l of loans) {
    if (l.loan_type !== 'education_loan' || (l.currency ?? 'INR') !== 'INR' || D(l.outstanding).lte(0)) continue;
    anyLoan = true;
    const { interest } = nextYearSplit(l);
    const left = sec80eMonthsLeft(l.edu_interest_start, currentMonth);
    const part = left == null ? new Decimal(1) : Decimal.min(1, new Decimal(left).div(12));
    amount = amount.add(interest.mul(part).mul(taxShare(l)));
  }
  return { amount, anyLoan };
}

/** The comparison's inputs from a profile, and what was assumed. */
export function regimeInputsFromUser(user: UserPayload, currentMonth: string): { inputs: RegimeInputs; hasBusiness: boolean; assumptions: string[] } {
  const income = readIncome(user);
  const ded = user.deductions ?? {};
  const edu = eduInterestInWindow(user.loans, currentMonth);
  const assumptions: string[] = [];
  if (income.source === 'none') assumptions.push('No gross income in Profile yet, so there is nothing to compare. Add your gross salary or business income.');
  if (user.age_bracket === '60_plus') assumptions.push('Aged 60+: the old regime’s 60-79 table is used (80+ pays less).');
  if (user.loans.some((l) => l.loan_type === 'home_loan' && l.property_use === 'let_out' && !l.annual_rent)) {
    assumptions.push('A let-out home has no rent entered: its rent and interest are left out except for the old regime’s ₹2L loss set-off (simplified).');
  }
  if (!edu.anyLoan && D(ded.sec_80e_annual).gt(0)) assumptions.push('Education-loan interest is taken from your 80E entry.');
  const inputs: RegimeInputs = {
    salary: income.salary,
    businessIncome: income.business,
    otherIncome: income.other,
    age: oldRegimeAge(user),
    hraExemption: D(ded.hra_claim_annual),
    sec80cOther: D(ded.sec_80c_annual),
    sec80d: Decimal.min(D(ded.sec_80d_annual), user.age_bracket === '60_plus' ? 50_000 : 25_000),
    sec80ccd1b: D(ded.sec_80ccd1b_annual),
    eduInterest: edu.anyLoan ? edu.amount : D(ded.sec_80e_annual),
    homeLoans: homeLoanYears(user.loans, currentMonth),
  };
  return { inputs, hasBusiness: income.business.gt(0), assumptions };
}

/** Live re-test 2 NEW-18: one way to print the tax rate everywhere (Home,
 *  Plan, Profile and Tax said 16% and 15.6% for the same 0.156). */
export function formatTaxRate(rate: Decimal.Value | null | undefined): string {
  // One decimal, always: what Profile and Tax already showed ("10.0%").
  return `${new Decimal(rate == null || rate === '' ? 0 : rate).mul(100).toFixed(1)}%`;
}
