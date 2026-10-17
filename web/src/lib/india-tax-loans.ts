/**
 * India: the tax side of each loan (sprint G2; grill #7, #10, #31).
 *
 * Income-tax Act, 2025 (in force 1 April 2026; tax-tables.json `law_as_of`),
 * with the 1961 numbers people still use in brackets:
 *   • Home loan interest, s.22(1)(b) [24(b)]: self-occupied, ₹2L a year in
 *     all (s.22(2)(a), (5)), ₹30k when the house wasn't finished within 5
 *     years of borrowing (s.22(2)(b)); old regime only (s.202(2)(a)(v)).
 *     Let out: deducted from the rent after 30% (s.22(1)(a)); a loss lowers
 *     other income up to ₹2L in the old regime (s.109(1)(b) [71(3A)]),
 *     not at all in the new one (s.202(2)(b)(ii)).
 *   • Pre-construction interest, s.22(1)(c): interest paid before the year
 *     the house was bought or finished, in five equal instalments from that
 *     year; since the Finance Act 2026 it counts inside the ₹2L cap.
 *   • Home loan principal, s.123 + Schedule XV para 1(r), 3 [80C]: inside
 *     the ₹1.5L cap with PF, PPF, ELSS, insurance, tuition; only from listed
 *     lenders (banks incl. co-operative banks, LIC, NHB, housing finance
 *     companies, some employers); reversed if the house is sold within 5
 *     years of the end of the year you got possession (Schedule XV para 4).
 *   • Education loan interest, s.129 [80E]: no cap, old regime only, for
 *     the tax year you first pay interest and the next seven; only on a
 *     loan from a bank, a notified financial institution or an approved
 *     charity, for higher education of yourself, your spouse or children.
 *   • Co-borrowers, s.24 [26]: each co-owner gets the relief "as if
 *     individually entitled", so each claims their own share, each with
 *     their own ₹2L and ₹1.5L.
 */
import Decimal from 'decimal.js';
import type { LoanPayload } from './api';
import TAX from './tax-tables.json';
import { fullCap24, HOUSE_USE_KINDS, principal80c, taxType } from '@/lib/loan-types';

const D = (v: Decimal.Value | null | undefined) => new Decimal(v == null || v === '' ? 0 : v);
const DED = TAX.in.deductions;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const monthsBetween = (from: string, to: string) => {
  const [fy, fm] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  return (ty - fy) * 12 + (tm - fm);
};

/** The 1961 section with its Income-tax Act 2025 number: "24(b) (now s.22)". */
export function sectionLabel(old: keyof typeof TAX.in.section_map | string): string {
  const map = TAX.in.section_map as Record<string, string>;
  const now = map[old];
  return now ? `s.${old} (now s.${now})` : `s.${old}`;
}

/** The user's share of a loan for tax, 0-1. */
export function taxShare(loan: Pick<LoanPayload, 'tax_share'>): Decimal {
  const s = D(loan.tax_share ?? 1);
  return s.isNaN() ? new Decimal(1) : Decimal.max(0, Decimal.min(1, s));
}

/** 'YYYY-MM' → the April–March tax year it falls in, by its starting year. */
export function taxYearOf(month: string): number {
  const [y, m] = month.split('-').map(Number);
  return m >= 4 ? y : y - 1;
}

/** Months, counting this one, the s.129 [80E] deduction can still be
 *  claimed: to 31 March of the 8th tax year from the first interest. 0 once
 *  ended; null when the start isn't known. As engine/tax/india.sec80e_months_left. */
export function sec80eMonthsLeft(firstInterest: string | undefined, currentMonth: string): number | null {
  if (!firstInterest || !MONTH.test(firstInterest)) return null;
  const endFy = taxYearOf(firstInterest) + DED.sec80e_tax_years; // window ends 31 Mar of this year
  return Math.max(0, monthsBetween(currentMonth, `${endFy}-03`) + 1);
}

/** This tax year's pre-construction instalment (one fifth, whole loan), or 0
 *  outside the five tax years from the year the house was finished. */
export function preConstructionInstalment(loan: Pick<LoanPayload, 'pre_construction_interest_total' | 'construction_completed'>, currentMonth: string): Decimal {
  const total = D(loan.pre_construction_interest_total);
  if (total.lte(0) || !loan.construction_completed || !MONTH.test(loan.construction_completed)) return new Decimal(0);
  const k = taxYearOf(currentMonth) - taxYearOf(loan.construction_completed);
  return k >= 0 && k < DED.pre_construction_instalments ? total.div(DED.pre_construction_instalments) : new Decimal(0);
}

/** The engine's tax fields for a plan run this month: the 80E window and
 *  this year's pre-construction instalment, from the calendar fields. */
export function resolveLoanTaxTiming(loan: LoanPayload, currentMonth: string): LoanPayload {
  let out = loan;
  if (loan.loan_type === 'education_loan' && loan.edu_interest_start) {
    const left = sec80eMonthsLeft(loan.edu_interest_start, currentMonth);
    if (left != null) out = { ...out, tax_deduction_months_left: left };
  }
  if (taxType(loan) === 'home_loan' && loan.pre_construction_interest_total) {
    out = { ...out, pre_construction_interest_annual: preConstructionInstalment(loan, currentMonth).toString() };
  }
  return out;
}

/** Interest and principal over the next 12 scheduled EMIs (no prepayment). */
export function nextYearSplit(loan: Pick<LoanPayload, 'outstanding' | 'nominal_rate' | 'scheduled_emi' | 'pre_emi_months_remaining'>): { interest: Decimal; principal: Decimal } {
  let bal = D(loan.outstanding);
  const r = D(loan.nominal_rate).div(12);
  const emi = D(loan.scheduled_emi);
  let interest = new Decimal(0);
  let principal = new Decimal(0);
  const preEmi = Number(loan.pre_emi_months_remaining ?? 0);
  for (let m = 0; m < 12 && bal.gt(0); m++) {
    const i = bal.mul(r);
    interest = interest.add(i);
    if (m < preEmi) continue; // pre-EMI: interest only
    const p = Decimal.max(0, Decimal.min(bal, emi.sub(i)));
    principal = principal.add(p);
    bal = bal.sub(p);
  }
  return { interest, principal };
}

/** Unused s.123 [80C] room after other items and the year's scheduled
 *  home-loan principal. A home-loan prepayment that fits in it also lowers
 *  old-regime tax. As engine/tax/india.sec80c_room. */
export function sec80cRoom(other80c: Decimal.Value, homePrincipal: Decimal.Value): Decimal {
  return Decimal.max(0, D(DED.sec80c_cap).sub(Decimal.max(0, D(other80c))).sub(Decimal.max(0, D(homePrincipal))));
}

/** Short plain-words line on what a loan's interest does for tax, by regime. */
export function loanTaxLine(loan: LoanPayload, regime: 'old' | 'new', currentMonth: string): string | null {
  const share = taxShare(loan);
  const yours = share.lt(1) ? ` on your ${share.mul(100).toDecimalPlaces(0).toString()}% share` : '';
  if (taxType(loan) === 'home_loan') {
    if (loan.property_use === 'let_out') {
      const rent = loan.annual_rent ? '' : ' Add the rent to count it exactly; without it only the ₹2L set-off is counted (simplified).';
      return regime === 'old'
        ? `Let out: interest${yours} comes off the rent (after 30%), and up to ₹2L of any loss off your other income (${sectionLabel('24(b)')}, ${sectionLabel('71(3A)')}).${rent}`
        : `Let out: interest${yours} comes off the rent (after 30%) in the new regime too, but a loss can't lower your salary or other income (s.202(2)(b)(ii)).${loan.annual_rent ? '' : ' Add the rent to count it.'}`;
    }
    if (regime === 'new') return `Self-occupied: no deduction in the new regime (s.202(2)(a)(v); 1961 s.115BAC). In the old regime: interest up to ₹2L and principal inside the ₹1.5L 80C limit.`;
    const cap = !fullCap24(loan) ? (loan.house_use === 'repair' ? '₹30,000 (repair or renovation)' : '₹30,000 (house finished more than 5 years after borrowing)') : '₹2L a year across your self-occupied homes';
    const p80c = principal80c(loan) ? `principal inside the ₹1.5L limit (${sectionLabel('80C')})` : `the principal doesn’t count in ${sectionLabel('80C')}`;
    return `Interest${yours} up to ${cap} (${sectionLabel('24(b)')}); ${p80c}.`;
  }
  if (HOUSE_USE_KINDS.includes(loan.loan_type)) {
    return `No tax break unless the money bought, built or repaired a house. If it did, say so under the loan and the interest counts like a home loan’s (${sectionLabel('24(b)')}).`;
  }
  if (loan.loan_type === 'education_loan') {
    if (regime === 'new') return `No deduction in the new regime. In the old regime the interest is deductible with no cap for 8 tax years (${sectionLabel('80E')}).`;
    const left = sec80eMonthsLeft(loan.edu_interest_start, currentMonth);
    if (left == null) return `Interest${yours} deductible with no cap, for the tax year you first paid interest and the next seven (${sectionLabel('80E')}). Add when you first paid interest so the plan stops the deduction when it ends.`;
    if (left === 0) return `The 8-tax-year window for this loan has ended (${sectionLabel('80E')}): its interest no longer lowers your tax.`;
    return `Interest${yours} deductible with no cap for ${left} more month${left === 1 ? '' : 's'} (${sectionLabel('80E')}).`;
  }
  return null;
}
