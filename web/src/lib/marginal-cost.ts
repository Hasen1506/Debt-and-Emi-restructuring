/**
 * Marginal cost of the next rupee/dollar prepaid (roadmap PR J, founder
 * decision 2026-10-07). TypeScript twin of engine/marginal_cost.py; the
 * differential test (web/tests/roadmap-j-marginal.cjs, fixture
 * engine/tests/fixtures/marginal_cost_cases.json) keeps the two equal.
 *
 *   marginal cost = interest, compounded monthly       (1 + r/12)^12 − 1
 *                 + GST on that interest, not compounding (Indian credit cards: 18%)
 *                 − tax benefit the prepayment gives up (24(b) / 80E / US mortgage
 *                                                        and student-loan interest)
 *                 − prepayment fee                     fee% × 12 / months left
 *
 * Sunk costs (the upfront processing fee and its GST, insurance already
 * paid) are left out: they don't change what the next payment saves. A
 * loan in its lock-in is ranked after every open loan.
 */
import Decimal from 'decimal.js';
import type { LoanPayload, UserPayload } from './api';
import { usMortgageShieldShare } from './deductions';
import { GST_RATE_IN, gstApplies } from './gst';
import { taxShare } from './india-tax-loans';
import { lockInMonthsLeft } from './roll-forward';
import TAX from './tax-tables.json';
import { getCountryToday, localIsoDate } from './today';
import { usMortgageMarginalRate } from './us-loans';
import { fullCap24, taxType } from '@/lib/loan-types';

const D = (v: Decimal.Value) => new Decimal(v);

/** Audit 80+ C4: lock-in months still to run (from the stamped
 *  `prepay_lock_in_until`), not the months as first typed, so a loan whose
 *  lock-in has ended stops being ranked last. */
function lockLeft(loan: LoanPayload, country: string): number {
  const c = (country === 'US' ? 'US' : 'IN') as Parameters<typeof getCountryToday>[0];
  return lockInMonthsLeft(loan, localIsoDate(getCountryToday(c)).slice(0, 7));
}

/** India's GST on card interest: the one rate in lib/gst.ts (engine/tax/gst.py). */
export const GST_ON_CARD_INTEREST_IN = GST_RATE_IN;
export const LOCKED_OFFSET = D('100');
export const OPEN_ENDED_MONTHS = 12;
export const IN_HOME_INTEREST_CAP = D('200000');
export const US_MORTGAGE_DEBT_LIMIT = D('750000');
export const US_STUDENT_INTEREST_CAP = D('2500');

export interface MarginalCost {
  interest: Decimal;
  gst: Decimal;
  taxBenefit: Decimal;
  fee: Decimal;
  lockInMonths: number;
  /** What the debt costs a year from here: interest + GST − tax break. The
   *  rate shown for a loan everywhere; the prepayment fee is a cost of
   *  prepaying, not of owing, so it comes off only in `total`. */
  annualCost: Decimal;
  total: Decimal;
  /** Round 2 (item 4): the earner's-currency adjustment for a loan in
   *  another currency (drift + transfer cost); 0 for a same-currency loan. */
  fxAdjust?: Decimal;
  locked: boolean;
  /** Sort key, highest first: the total, with locked loans last. */
  orderKey: Decimal;
}

export function compounded(nominal: Decimal.Value): Decimal {
  return D(1).plus(D(nominal).div(12)).pow(12).minus(1);
}

export function marginalCost(
  nominalRate: Decimal.Value,
  cardGst: boolean,
  shieldFraction: Decimal.Value,
  prepaymentFeePct: Decimal.Value,
  monthsLeft: number,
  lockInMonths = 0,
): MarginalCost {
  const interest = compounded(nominalRate);
  // GST is 18% of the year's interest and is never itself charged interest:
  // RBI Credit Card Master Direction 2022, para 9(b)(ii) and FAQ 7 ("unpaid
  // charges/levies/taxes shall not be capitalized"). 42% → 51.11% + 9.20% = 60.31%.
  // https://www.rbi.org.in/Scripts/BS_ViewMasDirections.aspx?id=12300 (read 2026-10-12); C22: now in the
  // consolidated card Directions 2025, id=13155 (NBFC id=12956), checked 14 Oct 2026.
  const gst = cardGst ? interest.times(GST_ON_CARD_INTEREST_IN) : D(0);
  const taxBenefit = interest.times(D(shieldFraction));
  const k = monthsLeft > 0 ? monthsLeft : OPEN_ENDED_MONTHS;
  const feePct = D(prepaymentFeePct || 0);
  const fee = feePct.gt(0) ? feePct.times(12).div(k) : D(0);
  const annualCost = interest.plus(gst).minus(taxBenefit);
  const total = annualCost.minus(fee);
  const lock = Math.max(0, Math.trunc(lockInMonths));
  return { interest, gst, taxBenefit, fee, lockInMonths: lock, annualCost, total, locked: lock > 0, orderKey: lock > 0 ? total.minus(LOCKED_OFFSET) : total };
}

/** India-only inputs to marginalShield (engine: share, let_out, cap, deduction_open). */
export interface IndiaShieldOptions {
  share?: Decimal.Value;
  letOut?: boolean;
  cap?: Decimal.Value | null;
  deductionOpen?: boolean;
}

/** Tax saved on the NEXT unit of interest, as a share of it (see the engine's
 *  marginal_shield): a cap that already binds gives nothing at the margin. */
export function marginalShield(
  loanType: string,
  country: string,
  marginalRate: Decimal.Value,
  regime = 'new',
  itemises = true,
  itemisedShare: Decimal.Value = 1,
  interestTotal: Decimal.Value = 0,
  debtTotal: Decimal.Value = 0,
  phaseoutFactor: Decimal.Value = 1,
  india: IndiaShieldOptions = {},
): Decimal {
  const m = D(marginalRate || 0);
  if (country === 'IN') {
    // Sprint G2, as the engine: the user's share (co-borrower), a let-out
    // home checked against its own room, the ₹30k cap, the 80E window.
    const sh = Decimal.max(0, Decimal.min(1, D(india.share ?? 1)));
    if (loanType === 'home_loan') {
      if (india.letOut) return india.cap != null && D(interestTotal).lt(D(india.cap)) ? m.times(sh) : D(0);
      const limit = india.cap != null ? D(india.cap) : IN_HOME_INTEREST_CAP;
      return regime === 'old' && D(interestTotal).lt(limit) ? m.times(sh) : D(0);
    }
    if (loanType === 'education_loan') return regime === 'old' && india.deductionOpen !== false ? m.times(sh) : D(0);
    return D(0);
  }
  if (loanType === 'home_loan') return itemises && D(itemisedShare).gt(0) && D(debtTotal).lt(US_MORTGAGE_DEBT_LIMIT) ? m : D(0);
  if (loanType === 'education_loan') return D(interestTotal).lt(US_STUDENT_INTEREST_CAP) ? m.times(D(phaseoutFactor)) : D(0);
  return D(0);
}

/** The prepayment fee as charged: an Indian lender adds 18% GST on it
 *  (engine marginal_cost.prepayment_fee_with_gst; grill #27). */
export function prepaymentFeeWithGst(feePct: Decimal.Value, india: boolean): Decimal {
  const f = D(feePct || 0);
  return india && gstApplies('prepayment_fee') ? f.plus(f.times(GST_RATE_IN)) : f;
}

/** A home loan's year of interest (+ pre-construction instalment) in the user's share. */
function indiaOwnInterest(l: LoanPayload): Decimal {
  return D(l.outstanding || 0).times(D(l.nominal_rate || 0)).plus(D(l.pre_construction_interest_annual || 0)).times(taxShare(l));
}

/** As the engine's _india_shield_kwargs, for today (sim month 1). */
export function indiaShieldOptions(l: LoanPayload, regime: string, homeInterest: Decimal.Value, month = 1): IndiaShieldOptions {
  const o: IndiaShieldOptions = { share: taxShare(l) };
  if (taxType(l) === 'home_loan') {
    if (l.property_use === 'let_out') {
      const used = regime === 'old' ? Decimal.min(D(homeInterest), D(TAX.in.deductions.sec24b_self_occupied_cap)) : D(0);
      o.letOut = true;
      o.cap = letOutRoom(regime, l.annual_rent, taxShare(l), used);
    } else if (!fullCap24(l)) {
      o.cap = D(TAX.in.deductions.sec24b_other_cap);
    }
  } else if (l.loan_type === 'education_loan' && l.tax_deduction_months_left != null) {
    o.deductionOpen = month <= l.tax_deduction_months_left;
  }
  return o;
}

/** engine/tax/india.let_out_room: rent after municipal tax and 30%, in the
 *  user's share, plus what's left of the old regime's ₹2L set-off. */
export function letOutRoom(regime: string, annualRent: Decimal.Value | null | undefined, share: Decimal.Value, setOffUsed: Decimal.Value = 0): Decimal {
  const rent = annualRent == null || annualRent === '' ? D(0) : D(annualRent);
  const rentPart = rent.gt(0) ? rent.times(D(share)).times(D(1).minus(TAX.in.deductions.let_out_standard_deduction)) : D(0);
  const setOff = regime === 'old' ? Decimal.max(0, D(TAX.in.deductions.hp_loss_set_off_cap).minus(D(setOffUsed))) : D(0);
  return rentPart.plus(setOff);
}

function marketOf(loan: Pick<LoanPayload, 'currency'>, country: string): string {
  return loan.currency === 'INR' ? 'IN' : loan.currency === 'USD' ? 'US' : country;
}

/** {index → MarginalCost} for the user's open loans, as of today. The US
 *  student-loan income phase-out isn't modelled here (the engine's is), so
 *  a high earner's student loan can read a little dearer on screen. */
export function userMarginalCosts(user: UserPayload, marginalRate: string, indices?: number[]): Map<number, MarginalCost> {
  const own = user.country;
  const open = (l: LoanPayload) => D(l.outstanding || 0).gt(0);
  const idx = indices ?? user.loans.map((_, i) => i).filter((i) => open(user.loans[i]));
  const loans = user.loans;
  const sameMarket = (l: LoanPayload) => marketOf(l, own) === own && open(l);
  const homes = loans.filter((l) => taxType(l) === 'home_loan' && sameMarket(l));
  const edu = loans.filter((l) => l.loan_type === 'education_loan' && sameMarket(l));
  const interestOf = (ls: LoanPayload[]) => ls.reduce((s, l) => s.plus(D(l.outstanding || 0).times(D(l.nominal_rate || 0))), D(0));
  // India: the user's share of self-occupied interest + pre-construction
  // instalments, which share one ₹2L cap (engine _shield_context).
  const homeInterest = own === 'IN'
    ? homes.filter((l) => l.property_use !== 'let_out').reduce((s, l) => s.plus(indiaOwnInterest(l)), D(0))
    : interestOf(homes);
  const homeDebt = homes.reduce((s, l) => s.plus(D(l.outstanding || 0)), D(0));
  const eduInterest = interestOf(edu);
  // US: the share of mortgage interest above the standard deduction (the
  // engine's itemised_share); an itemiser is someone for whom it is > 0.
  const itemisedShare = usMortgageShieldShare(user);
  const out = new Map<number, MarginalCost>();
  for (const i of idx) {
    const l = loans[i];
    if (!l || !open(l)) continue;
    const regime = user.tax_regime ?? 'new';
    const india = own === 'IN' ? indiaShieldOptions(l, regime, homeInterest) : {};
    const total = india.letOut ? indiaOwnInterest(l) : taxType(l) === 'home_loan' ? homeInterest : eduInterest;
    // A US mortgage saves no state tax in a no-income-tax state or one that
    // disallows mortgage interest (lib/us-loans, engine _home_rate, #79).
    const rate = own === 'US' && taxType(l) === 'home_loan'
      ? usMortgageMarginalRate(marginalRate, user.state, user.state_marginal_rate ?? 0).toString()
      : marginalRate;
    const shield = marginalShield(
      taxType(l), own, rate, regime, itemisedShare.gt(0), itemisedShare,
      total, homeDebt, 1, india,
    );
    const cardGst = l.loan_type === 'credit_card' && marketOf(l, own) === 'IN';
    const mc = marginalCost(l.nominal_rate || 0, cardGst, shield, prepaymentFeeWithGst(l.prepayment_penalty_pct || 0, marketOf(l, own) === 'IN'), Number(l.tenure_months_remaining || 0), lockLeft(l, own));
    out.set(i, withFx(mc, fxAdjust(l, user, mc.annualCost, Number(l.tenure_months_remaining || 0))));
  }
  return out;
}

/** World Bank average US → India cost of sending money ($500, Q3 2025);
 *  engine/cross_border.REMITTANCE_COST_DEFAULT. */
export const REMITTANCE_COST_DEFAULT: Record<string, string> = { USD: '0.0245' };

/** Round 2 (item 4, engine marginal_cost._fx_adjust): a loan in another
 *  currency than the user's pay, valued in the user's currency:
 *  ((1 − c)^(1/years) · (1 + k) · (1 + drift)) − 1 − k. */
export function fxAdjust(l: LoanPayload, user: Pick<UserPayload, 'country' | 'fx_drift_annualized'> & { remittance_cost?: string }, annualCost: Decimal, monthsLeft: number): Decimal {
  const home = user.country === 'US' ? 'USD' : 'INR';
  const ccy = (l.currency || home).toUpperCase();
  if (ccy === home) return D(0);
  const drift = D(user.fx_drift_annualized?.[ccy] ?? 0);
  const c = user.remittance_cost != null && user.remittance_cost !== ''
    ? D(user.remittance_cost)
    : ccy === 'INR' ? D(REMITTANCE_COST_DEFAULT[home] ?? 0) : D(0);
  if (drift.isZero() && c.isZero()) return D(0);
  const years = Math.max(1, Math.ceil(Math.max(0, monthsLeft) / 12));
  const kept = D(String(Math.pow(1 - c.toNumber(), 1 / years)));
  return kept.times(D(1).plus(annualCost)).times(D(1).plus(drift)).minus(1).minus(annualCost);
}

function withFx(mc: MarginalCost, fx: Decimal): MarginalCost {
  if (fx.isZero()) return mc;
  const total = mc.total.plus(fx);
  return { ...mc, fxAdjust: fx, annualCost: mc.annualCost.plus(fx), total, orderKey: mc.locked ? total.minus(LOCKED_OFFSET) : total };
}

/** One loan on its own (Profile's preview while a loan is typed in): its
 *  own interest stands for the tax caps. `itemises` as computeBreakdown's:
 *  true = all mortgage interest lowers tax, or the share that does. */
export function loanMarginalCost(
  loan: LoanPayload,
  country: string,
  marginalRate: Decimal.Value,
  regime: string = 'new',
  itemises: boolean | Decimal = true,
): MarginalCost {
  const share = itemises === true ? D(1) : itemises === false ? D(0) : D(itemises);
  const interest = D(loan.outstanding || 0).times(D(loan.nominal_rate || 0));
  const own = marketOf(loan, country) === country;
  const india = own && country === 'IN' ? indiaShieldOptions(loan, regime, loan.property_use === 'let_out' ? 0 : indiaOwnInterest(loan)) : {};
  const total = country === 'IN' && taxType(loan) === 'home_loan' ? indiaOwnInterest(loan) : interest;
  const shield = own ? marginalShield(taxType(loan), country, marginalRate, regime, share.gt(0), share, total, D(loan.outstanding || 0), 1, india) : D(0);
  const cardGst = loan.loan_type === 'credit_card' && marketOf(loan, country) === 'IN';
  return marginalCost(loan.nominal_rate || 0, cardGst, shield, prepaymentFeeWithGst(loan.prepayment_penalty_pct || 0, marketOf(loan, country) === 'IN'), Number(loan.tenure_months_remaining || 0), lockLeft(loan, country));
}

const pct = (v: Decimal) => `${v.times(100).toFixed(2)}%`;

/** The breakdown lines for "why this loan first". */
export function whyFirstLines(mc: MarginalCost): { label: string; value: string; sign: '+' | '−' | '=' }[] {
  const lines: { label: string; value: string; sign: '+' | '−' | '=' }[] = [{ label: 'Interest, compounded monthly', value: pct(mc.interest), sign: '+' }];
  if (mc.gst.gt(0)) lines.push({ label: 'GST on the interest (18%); RBI bars interest on it', value: pct(mc.gst), sign: '+' });
  if (mc.taxBenefit.gt(0)) lines.push({ label: 'Tax break you’d give up', value: pct(mc.taxBenefit), sign: '−' });
  if (mc.fee.gt(0)) {
    lines.push({ label: 'What it costs you a year', value: pct(mc.annualCost), sign: '=' });
    lines.push({ label: 'Prepayment fee (with 18% GST in India), over the months left', value: pct(mc.fee), sign: '−' });
  }
  lines.push({ label: 'Each extra payment here saves', value: `${pct(mc.total)} a year`, sign: '=' });
  return lines;
}

/** One line, the same words as the engine's why_first. */
export function whyFirst(mc: MarginalCost): string {
  const parts = [`${pct(mc.interest)} interest (compounded monthly)`];
  if (mc.gst.gt(0)) parts.push(`+ ${pct(mc.gst)} GST on it`);
  if (mc.taxBenefit.gt(0)) parts.push(`− ${pct(mc.taxBenefit)} tax break you'd give up`);
  if (mc.fee.gt(0)) parts.push(`− ${pct(mc.fee)} prepayment fee`);
  let s = `The next payment here saves ${pct(mc.total)} a year: ${parts.join(' ')}`;
  if (mc.locked) s += `; locked against prepayment for ${mc.lockInMonths} more month${mc.lockInMonths === 1 ? '' : 's'}`;
  return s;
}
