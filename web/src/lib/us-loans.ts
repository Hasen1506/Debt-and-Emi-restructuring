/**
 * US loan rules (sprint G3; grill #33, #34, #79): federal student loans, PMI
 * and FHA mortgage insurance, each state's treatment of mortgage interest,
 * and the SALT cap. TypeScript twin of engine/us_loans.py and
 * engine/tax/usa.py's SALT schedule; web/tests/us-market.cjs checks every
 * case in engine/tests/fixtures/us_loan_cases.json against this file.
 *
 * Sources (read 2026-10-12), each a primary source:
 * - PSLF: https://studentaid.gov/manage-loans/forgiveness-cancellation/public-service
 * - IDR plans after the One Big Beautiful Bill Act (RAP from 1 July 2026):
 *   https://studentaid.gov/manage-loans/repayment/plans/income-driven
 * - Private refinancing ends federal protections (CFPB):
 *   https://www.consumerfinance.gov/paying-for-college/repay-student-debt/federal-and-private-student-loans
 * - IDR forgiveness taxable after 2025 (IRS Taxpayer Advocate):
 *   https://www.taxpayeradvocate.irs.gov/news/tax-tips/what-to-know-about-student-loan-forgiveness-and-your-taxes/2026/03
 * - PMI 80% request / 78% automatic (CFPB):
 *   https://www.consumerfinance.gov/ask-cfpb/when-can-i-remove-private-mortgage-insurance-pmi-from-my-loan-en-202/
 * - FHA MIP 11 years or loan term (HUD):
 *   https://answers.hud.gov/FHA/s/article/How-long-is-MIP-collected-for-case-numbers-assigned-on-or-after-June-3-2013
 * - PMI deductible for 2026 (IRS Pub 936 draft): https://www.irs.gov/pub/irs-dft/p936--dft.pdf
 * - SALT cap, IRC §164(b)(7): https://www.law.cornell.edu/uscode/text/26/164
 * - No-income-tax states (Tax Foundation 2026), PA DOR, MA DOR: see SOURCES.
 */
import Decimal from 'decimal.js';
import type { LoanPayload } from './api';

const D = (v: Decimal.Value) => new Decimal(v);

// Rules as of 2026-10-12.

export const US_SOURCES = {
  pslf: 'https://studentaid.gov/manage-loans/forgiveness-cancellation/public-service',
  idr: 'https://studentaid.gov/manage-loans/repayment/plans/income-driven',
  obbba: 'https://studentaid.gov/announcements-events/big-updates',
  refi: 'https://www.consumerfinance.gov/paying-for-college/repay-student-debt/federal-and-private-student-loans',
  forgivenessTax: 'https://www.taxpayeradvocate.irs.gov/news/tax-tips/what-to-know-about-student-loan-forgiveness-and-your-taxes/2026/03',
  pmi: 'https://www.consumerfinance.gov/ask-cfpb/when-can-i-remove-private-mortgage-insurance-pmi-from-my-loan-en-202/',
  fhaMip: 'https://answers.hud.gov/FHA/s/article/How-long-is-MIP-collected-for-case-numbers-assigned-on-or-after-June-3-2013',
  pmiDeduction: 'https://www.irs.gov/pub/irs-dft/p936--dft.pdf',
  salt: 'https://www.law.cornell.edu/uscode/text/26/164',
  noIncomeTax: 'https://taxfoundation.org/data/all/state/state-income-tax-rates-2026/',
  nh: 'https://www.revenue.nh.gov/news-and-media/repeal-nh-interest-and-dividends-tax-now-effect',
  pa: 'https://www.pa.gov/agencies/revenue/forms-and-publications/pa-personal-income-tax-guide/deductions-and-credits',
  ma: 'https://www.mass.gov/directive/directive-86-8-interest-expenses',
} as const;

// ── Student loans ───────────────────────────────────────────────────────────

type LoanLike = Pick<LoanPayload, 'loan_type' | 'currency' | 'student_loan_kind' | 'forgiveness_track'>;

export function onForgivenessTrack(l: LoanLike): boolean {
  return (
    l.loan_type === 'education_loan' &&
    (l.student_loan_kind || 'federal') !== 'private' &&
    (l.currency || '').toUpperCase() !== 'INR' &&
    (l.forgiveness_track === 'pslf' || l.forgiveness_track === 'idr')
  );
}

/** E7: a US federal or unmarked student loan with no PSLF/IDR answer yet
 *  (engine: forgiveness_answer_pending). Without `country`, only an
 *  explicitly dollar loan counts as US. */
export function forgivenessAnswerPending(l: LoanLike, country?: 'IN' | 'US'): boolean {
  if (l.loan_type !== 'education_loan' || (l.student_loan_kind || '') === 'private') return false;
  const t = l.forgiveness_track || '';
  if (t !== '' && t !== 'unsure') return false;
  const ccy = (l.currency || '').toUpperCase();
  if (country === undefined) return ccy === 'USD';
  return ccy ? ccy === 'USD' : country === 'US';
}

export const PENDING_HOLD_REASON =
  "isn't marked yet as federal or private, or as on PSLF or an income-driven plan, so extra " +
  "payments are held off it until you say: on a loan heading for forgiveness they're money " +
  'lost. Its required payment still goes';

/** Why extra payments are held off the loan, or null (engine: forgiveness_prepay_block). */
export function forgivenessPrepayBlock(l: LoanLike, country?: 'IN' | 'US'): string | null {
  if (forgivenessAnswerPending(l, country)) return PENDING_HOLD_REASON;
  if (!onForgivenessTrack(l)) return null;
  if (country !== undefined) {
    const ccy = (l.currency || '').toUpperCase();
    if (!(ccy ? ccy === 'USD' : country === 'US')) return null;
  }
  if (l.forgiveness_track === 'pslf')
    return (
      'is on track for Public Service Loan Forgiveness, so extra payments only shrink ' +
      'what would be forgiven tax-free; it gets its required payment and no more'
    );
  return (
    'is on an income-driven plan you expect to end in forgiveness, so extra payments only ' +
    'shrink what would be forgiven; it gets its required payment and no more'
  );
}

/** Plain lines for the loan card (engine: student_loan_explainer). */
export function studentLoanExplainer(l: LoanLike): string[] {
  const kind = l.student_loan_kind || '';
  const track = l.forgiveness_track || '';
  const out: string[] = [];
  if (kind === 'private') {
    out.push(
      'Private student loan: no federal repayment plans or forgiveness, so it is ' +
        'paid off like any other loan, and refinancing it can make sense.',
    );
    return out;
  }
  if (!kind)
    out.push(
      'Not marked federal or private yet. We treat it as federal (most US student ' +
        "debt is), so we never suggest refinancing it with a private lender. Your loans " +
        "are listed on studentaid.gov if you're not sure.",
    );
  if (track === 'pslf')
    out.push(
      'PSLF: the rest is forgiven after 120 qualifying payments while you work full ' +
        'time for a government or not-for-profit employer, and PSLF forgiveness isn\'t ' +
        'taxed. Extra payments are held off this loan; your required payment still goes.',
    );
  else if (track === 'idr')
    out.push(
      "Income-driven forgiveness: what's left is forgiven after 20, 25 or 30 years " +
        '(RAP is 30). Since 1 January 2026 that forgiven amount is generally taxable ' +
        'income, so set some money aside for it. Extra payments are held off this loan.',
    );
  else if ((track === '' || track === 'unsure') && (l.currency || '').toUpperCase() !== 'INR')
    out.push(
      'Not yet answered: is it on PSLF or an income-driven plan? Until you say, extra ' +
        "payments are held off this loan (on a loan that will be forgiven they're money " +
        'lost). PSLF needs a government or not-for-profit employer; payments on the ' +
        "Tiered Standard plan don't count toward it.",
    );
  else
    out.push(
      "Federal loan, not on a forgiveness track: it's treated like any other loan in " +
        'the payoff order. Since 1 July 2026 the income-driven plans are RAP and IBR ' +
        '(ICR and PAYE close by July 2028); loans taken from 1 July 2026 can use only ' +
        'RAP or the Tiered Standard plan.',
    );
  return out;
}

// ── Mortgage insurance ──────────────────────────────────────────────────────

export const PMI_REQUEST_LTV = D('0.80');
export const PMI_AUTO_LTV = D('0.78');

type HomeLike = Pick<
  LoanPayload,
  'loan_type' | 'outstanding' | 'nominal_rate' | 'scheduled_emi' | 'pmi_monthly' | 'original_home_value' |
  'mortgage_insurance_kind' | 'pmi_months_remaining'
>;

export function mortgageInsuranceKind(l: HomeLike): 'pmi' | 'fha_mip' | null {
  if (l.loan_type !== 'home_loan' || !D(l.pmi_monthly || 0).gt(0)) return null;
  return l.mortgage_insurance_kind || 'pmi';
}

/** This month's mortgage insurance (engine: pmi_due). */
export function pmiDue(l: HomeLike): Decimal {
  const kind = mortgageInsuranceKind(l);
  const bal = D(l.outstanding || 0);
  if (!kind || !bal.gt(0)) return D(0);
  if (l.pmi_months_remaining != null && l.pmi_months_remaining <= 0) return D(0);
  const v = D(l.original_home_value || 0);
  if (kind === 'pmi' && v.gt(0) && bal.lte(PMI_REQUEST_LTV.times(v))) return D(0);
  return D(l.pmi_monthly || 0);
}

function monthsUntil(balance: Decimal, rate: Decimal, payment: Decimal, target: Decimal, cap = 1200): number | null {
  if (balance.lte(target)) return 0;
  const r = rate.div(12);
  let b = balance;
  for (let m = 1; m <= cap; m++) {
    b = b.plus(b.times(r)).minus(payment);
    if (b.lte(target)) return m;
    if (m > 1 && b.gte(balance) && payment.lte(balance.times(r))) return null;
  }
  return null;
}

export interface PmiAnalysis {
  kind: 'pmi' | 'fha_mip';
  monthly: Decimal;
  annual: Decimal;
  requestBalance: Decimal | null;
  autoBalance: Decimal | null;
  extraToRequestNow: Decimal | null;
  monthsToRequest: number | null;
  monthsToAuto: number | null;
  pmiSavedByPayingNow: Decimal | null;
  pmiReturnPct: Decimal | null;
  notes: string[];
}

const q2 = (x: Decimal) => x.toDecimalPlaces(2, Decimal.ROUND_HALF_EVEN);

/** When PMI can end and what reaching 80% now is worth (engine: pmi_analysis). */
export function pmiAnalysis(l: HomeLike): PmiAnalysis | null {
  const kind = mortgageInsuranceKind(l);
  if (!kind) return null;
  const monthly = D(l.pmi_monthly || 0);
  const a: PmiAnalysis = {
    kind, monthly, annual: monthly.times(12), requestBalance: null, autoBalance: null,
    extraToRequestNow: null, monthsToRequest: null, monthsToAuto: null,
    pmiSavedByPayingNow: null, pmiReturnPct: null, notes: [],
  };
  if (kind === 'fha_mip') {
    a.notes.push(
      "FHA mortgage insurance doesn't end at 80% or 78%. For FHA loans from 3 June 2013 it runs " +
        '11 years if you borrowed 90% or less of the home\'s value, otherwise for the loan\'s term ' +
        '(HUD). Refinancing to a conventional loan is the usual way out; that\'s a big decision ' +
        'with its own costs.',
    );
    if (l.pmi_months_remaining) a.notes.push(`You entered ${l.pmi_months_remaining} months of MIP left.`);
    return a;
  }
  const v = D(l.original_home_value || 0);
  if (!v.gt(0)) {
    a.notes.push(
      "Add the home's original value (the lower of the price and the appraisal when you " +
        'bought it) to see when PMI can end.',
    );
    return a;
  }
  const bal = D(l.outstanding || 0);
  const rate = D(l.nominal_rate || 0);
  const pay = D(l.scheduled_emi || 0);
  a.requestBalance = q2(PMI_REQUEST_LTV.times(v));
  a.autoBalance = q2(PMI_AUTO_LTV.times(v));
  a.extraToRequestNow = q2(Decimal.max(0, bal.minus(a.requestBalance)));
  a.monthsToRequest = monthsUntil(bal, rate, pay, a.requestBalance);
  a.monthsToAuto = monthsUntil(bal, rate, pay, a.autoBalance);
  if (a.extraToRequestNow.gt(0) && a.monthsToRequest) {
    a.pmiSavedByPayingNow = q2(monthly.times(a.monthsToRequest));
    a.pmiReturnPct = a.annual.div(a.extraToRequestNow).toDecimalPlaces(4, Decimal.ROUND_HALF_EVEN);
  }
  a.notes.push(
    'You can ask your servicer in writing to cancel PMI once the balance is 80% of the original ' +
      'value, earlier if you pay extra. You need a good payment history, no second mortgage, and ' +
      "possibly an appraisal showing the value hasn't fallen. It ends on its own when the balance " +
      "is scheduled to reach 78%, and at the loan's halfway point at the latest (CFPB).",
  );
  a.notes.push(
    'For 2026, PMI counts as deductible mortgage interest if you itemise and your AGI is $100,000 ' +
      "or less (phased out up to $109,000). The plan doesn't take that into account.",
  );
  return a;
}

export const ESCROW_NOTE =
  'Enter the payment as principal and interest only. Escrow (property tax and home insurance the ' +
  'servicer collects with it) goes in your monthly fixed expenses, and PMI in its own field, so ' +
  'the plan can drop PMI when it ends.';

// ── State treatment of mortgage interest ────────────────────────────────────

export const US_STATES = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'DC', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS',
  'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC',
  'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
] as const;
export const NO_INCOME_TAX_STATES = ['AK', 'FL', 'NV', 'NH', 'SD', 'TN', 'TX', 'WA', 'WY'];
const NO_MORTGAGE_DEDUCTION: Record<string, keyof typeof US_SOURCES> = { PA: 'pa', MA: 'ma' };

export interface StateMortgageTreatment {
  state: string | null;
  kind: 'no_income_tax' | 'no_deduction' | 'unverified' | 'unknown';
  modelled: boolean;
  label: string;
  sourceUrl: string | null;
}

export function stateMortgageTreatment(state?: string | null): StateMortgageTreatment {
  const s = (state || '').trim().toUpperCase();
  if (!s)
    return {
      state: null, kind: 'unknown', modelled: false, sourceUrl: null,
      label: 'Add your state to see whether it taxes income and lets you deduct mortgage interest.',
    };
  if (NO_INCOME_TAX_STATES.includes(s))
    return {
      state: s, kind: 'no_income_tax', modelled: true,
      sourceUrl: s === 'NH' ? US_SOURCES.nh : US_SOURCES.noIncomeTax,
      label: `${s} has no state income tax on wages, so mortgage interest saves only federal tax.`,
    };
  if (NO_MORTGAGE_DEDUCTION[s])
    return {
      state: s, kind: 'no_deduction', modelled: true, sourceUrl: US_SOURCES[NO_MORTGAGE_DEDUCTION[s]],
      label: `${s} doesn't let you deduct home mortgage interest, so it saves only federal tax.`,
    };
  return {
    state: s, kind: 'unverified', modelled: false, sourceUrl: null,
    label:
      `State rules vary and we haven't verified ${s}'s: the plan assumes your state lets you deduct ` +
      "mortgage interest at your state rate. Check your state's income-tax instructions.",
  };
}

/** The rate a US mortgage's interest saves tax at (engine: us_mortgage_marginal_rate). */
export function usMortgageMarginalRate(marginalRate: Decimal.Value, state: string | null | undefined, stateRate: Decimal.Value): Decimal {
  const t = stateMortgageTreatment(state);
  if (t.kind === 'no_income_tax' || t.kind === 'no_deduction') return Decimal.max(0, D(marginalRate).minus(D(stateRate || 0)));
  return D(marginalRate);
}

// ── SALT cap ────────────────────────────────────────────────────────────────

const SALT_CAP: Record<number, string> = { 2025: '40000', 2026: '40400' };
const SALT_THRESHOLD: Record<number, string> = { 2025: '500000', 2026: '505000' };

function indexed(table: Record<number, string>, year: number): Decimal {
  if (table[year]) return D(table[year]);
  const last = Math.max(...Object.keys(table).map(Number));
  let amt = D(table[last]);
  for (let y = last; y < year; y++) amt = amt.times('1.01');
  return amt;
}

/** SALT deduction cap for a tax year after the MAGI phase-down (engine: salt_cap_for_year). */
export function saltCapForYear(year: number, magi?: Decimal.Value | null, marriedSeparately = false): Decimal {
  const half = marriedSeparately ? D('0.5') : D(1);
  if (year >= 2030) return D(10000).times(half);
  const cap = indexed(SALT_CAP, year).times(half);
  const threshold = indexed(SALT_THRESHOLD, year).times(half);
  if (magi == null || D(magi).lte(threshold)) return cap;
  return Decimal.max(D(10000).times(half), cap.minus(D('0.30').times(D(magi).minus(threshold))));
}

/** One line for the deductions form. */
export const SALT_CAP_COPY =
  'SALT cap for 2026: $40,400 of state + local income and property tax combined ($20,200 married ' +
  'filing separately), cut by 30% of MAGI above $505,000 but never below $10,000 (IRC §164(b)(7)).';

/** The US-only fields to send for a loan: kept on a US-market loan of the
 *  right type, blanked otherwise, so a rupee loan never carries a PSLF track. */
export function usLoanFieldsFor(l: LoanPayload, country: 'IN' | 'US'): Partial<LoanPayload> {
  const us = (l.currency ? l.currency === 'USD' : country === 'US');
  const blank = {
    student_loan_kind: undefined, forgiveness_track: undefined, pmi_monthly: undefined,
    original_home_value: undefined, mortgage_insurance_kind: undefined, pmi_months_remaining: undefined,
  };
  if (!us) return blank;
  if (l.loan_type === 'education_loan')
    return { ...blank, student_loan_kind: l.student_loan_kind, forgiveness_track: l.forgiveness_track };
  if (l.loan_type === 'home_loan' && D(l.pmi_monthly || 0).gt(0))
    return {
      ...blank,
      pmi_monthly: D(l.pmi_monthly || 0).toString(),
      original_home_value: l.original_home_value && D(l.original_home_value).gt(0) ? D(l.original_home_value).toString() : undefined,
      mortgage_insurance_kind: l.mortgage_insurance_kind,
      pmi_months_remaining: l.pmi_months_remaining,
    };
  return blank;
}
