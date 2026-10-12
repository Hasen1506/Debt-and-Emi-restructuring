/**
 * Old vs new tax regime for this tax year, with the user's loans counted
 * (India; sprint G2, grill #32). The same rules as the engine's
 * `engine/tax/india.compare_regimes`; web/tests/g2-india-tax.cjs checks the
 * two against engine/tests/fixtures/regime_compare_cases.json.
 *
 * Law: Income-tax Act, 2025 as amended by the Finance Act, 2026 (tax year
 * 2026-27; tax-tables.json `law_as_of` / `law_source`). Old regime: salary
 * less ₹50k standard deduction and HRA; house property (s.22, 1961 s.24);
 * s.123 (80C) with home-loan principal, s.126 (80D), s.124 (80CCD(1B)),
 * s.129 (80E). New regime (s.202, 1961 s.115BAC): ₹75k standard deduction,
 * no Chapter VIII deductions, no self-occupied interest, and a house-property
 * loss doesn't lower other income.
 */
import Decimal from 'decimal.js';
import TAX from './tax-tables.json';

const D = (v: Decimal.Value | null | undefined) => new Decimal(v == null || v === '' ? 0 : v);
const ZERO = new Decimal(0);
const ONE = new Decimal(1);

export type OldAge = '60_79' | '80_plus' | undefined;

export interface HomeLoanYear {
  /** The loan's interest for the year (whole loan). */
  interest: Decimal.Value;
  /** Scheduled principal repaid in the year (whole loan). */
  principal?: Decimal.Value;
  /** The user's share, 0-1 (co-borrower). */
  share?: Decimal.Value;
  letOut?: boolean;
  /** Let-out: the year's rent for the whole house; omitted = not known. */
  annualRent?: Decimal.Value | null;
  municipalTax?: Decimal.Value;
  /** This year's one-fifth of pre-construction interest (s.22(1)(c)). */
  preConstructionInstalment?: Decimal.Value;
  /** False: not finished within 5 years of borrowing, cap ₹30k (s.22(2)(b)). */
  fullCap?: boolean;
  /** Lender listed in Schedule XV para 3(a)(iii) (banks, HFCs, LIC, NHB, employer...). */
  principal80cEligible?: boolean;
}

export interface RegimeInputs {
  salary?: Decimal.Value;
  businessIncome?: Decimal.Value;
  otherIncome?: Decimal.Value;
  age?: OldAge;
  hraExemption?: Decimal.Value;
  sec80cOther?: Decimal.Value;
  sec80d?: Decimal.Value;
  sec80ccd1b?: Decimal.Value;
  otherOldDeductions?: Decimal.Value;
  /** 80E interest inside its 8-tax-year window (user's share). */
  eduInterest?: Decimal.Value;
  homeLoans?: HomeLoanYear[];
}

export interface RegimeSide {
  taxable: Decimal;
  tax: Decimal;
  houseProperty: Decimal;
  chapterVIII: Decimal;
  loanDeductions: Decimal;
}

export interface RegimeComparison {
  old: RegimeSide;
  new: RegimeSide;
  better: 'old' | 'new' | 'same';
  /** New-regime tax minus old-regime tax (negative: the new regime is cheaper). */
  oldSaves: Decimal;
  /** Old-regime tax the loans save. */
  loansWorthInOld: Decimal;
  /** When the new regime wins: extra old-regime deductions that would flip it; null if none would. */
  extraDeductionsForOldToWin: Decimal | null;
  /** 'yearly': no business income, choose each year in the return. 'business_once': see switchRuleText. */
  switchRule: 'yearly' | 'business_once';
}

const DED = TAX.in.deductions;
const SO_CAP = D(DED.sec24b_self_occupied_cap);
const OTHER_CAP = D(DED.sec24b_other_cap);
const LET_OUT_STD = D(DED.let_out_standard_deduction);
const SET_OFF_CAP = D(DED.hp_loss_set_off_cap);
const CAP_80C = D(DED.sec80c_cap);
const CAP_80CCD1B = D(DED.sec80ccd1b_cap);

type Rows = Array<[number | null, number]>;
const rows = (r: Rows) => r.map(([limit, rate]) => [limit == null ? null : D(limit), D(rate)] as [Decimal | null, Decimal]);
const NEW_SLABS = rows(TAX.in.new.slabs as Rows);
const OLD_SLABS = rows(TAX.in.old.slabs as Rows);
const OLD_60_79 = rows(TAX.in.old_60_79.slabs as Rows);
const OLD_80_PLUS = rows(TAX.in.old_80_plus.slabs as Rows);
const SURCHARGE = rows(TAX.in.surcharge as Rows);
const SURCHARGE_THRESHOLDS = SURCHARGE.slice(0, -1).map(([l]) => l as Decimal);
const CESS = D(TAX.in.cess);

function slabTax(taxable: Decimal, slabs: Array<[Decimal | null, Decimal]>): Decimal {
  let tax = ZERO;
  let prev = ZERO;
  for (const [limit, rate] of slabs) {
    if (taxable.lte(prev)) break;
    const top = limit == null ? taxable : Decimal.min(taxable, limit);
    tax = tax.add(top.sub(prev).mul(rate));
    if (limit == null) break;
    prev = limit;
  }
  return tax;
}

function surchargeRate(taxable: Decimal, isNew: boolean): Decimal {
  for (const [limit, rate] of SURCHARGE) {
    if (limit == null || taxable.lte(limit)) return isNew ? Decimal.min(rate, D(TAX.in.surcharge_cap_new_regime)) : rate;
  }
  return ZERO;
}

function beforeSurcharge(taxable: Decimal, isNew: boolean, age: OldAge): Decimal {
  if (isNew) {
    let t = slabTax(taxable, NEW_SLABS);
    const line = D(TAX.in.new.rebate_87a.threshold);
    if (taxable.lte(line)) t = Decimal.max(ZERO, t.sub(TAX.in.new.rebate_87a.max));
    else t = Decimal.min(t, taxable.sub(line)); // s.156(2)(b) marginal relief
    return Decimal.max(ZERO, t);
  }
  const slabs = age === '80_plus' ? OLD_80_PLUS : age === '60_79' ? OLD_60_79 : OLD_SLABS;
  let t = slabTax(taxable, slabs);
  if (taxable.lte(TAX.in.old.rebate_87a.threshold)) t = Decimal.max(ZERO, t.sub(TAX.in.old.rebate_87a.max));
  return Decimal.max(ZERO, t);
}

/** Income tax under one regime: slabs, s.156 rebate, surcharge with marginal relief, 4% cess. */
export function regimeTax(taxable: Decimal.Value, regime: 'old' | 'new', age?: OldAge): Decimal {
  const ti = D(taxable);
  const isNew = regime === 'new';
  const tax = beforeSurcharge(ti, isNew, age);
  if (tax.lte(0)) return ZERO;
  const s = surchargeRate(ti, isNew);
  let withS = tax.mul(ONE.add(s));
  const below = SURCHARGE_THRESHOLDS.filter((t) => t.lt(ti));
  if (below.length && s.gt(0)) {
    const t = below[below.length - 1];
    withS = Decimal.min(withS, beforeSurcharge(t, isNew, age).mul(ONE.add(surchargeRate(t, isNew))).add(ti.sub(t)));
  }
  return withS.mul(ONE.add(CESS));
}

function houseProperty(inp: RegimeInputs, isOld: boolean): { used: Decimal; loanPart: Decimal } {
  const loans = inp.homeLoans ?? [];
  const so = loans.filter((h) => !h.letOut);
  const lo = loans.filter((h) => h.letOut);
  const soClaim = so.reduce((s, h) => s.add(D(h.interest).add(D(h.preConstructionInstalment)).mul(D(h.share ?? 1))), ZERO);
  let soCap = ZERO;
  if (isOld && so.length) {
    soCap = so.every((h) => h.fullCap !== false)
      ? SO_CAP
      : Decimal.min(SO_CAP, so.reduce((s, h) => s.add(h.fullCap !== false ? SO_CAP : OTHER_CAP), ZERO));
  }
  const soDeduction = Decimal.min(soClaim, soCap);
  let loNet = ZERO;
  let noInterest = ZERO;
  for (const h of lo) {
    const nav = Decimal.max(ZERO, D(h.annualRent).sub(D(h.municipalTax))).mul(D(h.share ?? 1));
    const afterStd = nav.mul(ONE.sub(LET_OUT_STD));
    loNet = loNet.add(afterStd).sub(D(h.interest).add(D(h.preConstructionInstalment)).mul(D(h.share ?? 1)));
    noInterest = noInterest.add(afterStd);
  }
  const total = loNet.sub(soDeduction);
  const used = total.lt(0) ? Decimal.max(total, isOld ? SET_OFF_CAP.neg() : ZERO) : total;
  return { used, loanPart: noInterest.sub(used) };
}

function side(inp: RegimeInputs, regime: 'old' | 'new', extraOld: Decimal = ZERO): RegimeSide {
  const isOld = regime === 'old';
  const salaryIn = Decimal.max(ZERO, D(inp.salary));
  const std = Decimal.min(D(isOld ? TAX.in.old.standard_deduction : TAX.in.new.standard_deduction), salaryIn);
  const salary = Decimal.max(ZERO, salaryIn.sub(std).sub(isOld ? D(inp.hraExemption) : ZERO));
  const hp = houseProperty(inp, isOld);
  const grossTotal = Decimal.max(ZERO, salary.add(D(inp.businessIncome)).add(D(inp.otherIncome)).add(hp.used));
  let chapter = ZERO;
  let loanChapter = ZERO;
  if (isOld) {
    const principal = (inp.homeLoans ?? [])
      .filter((h) => h.principal80cEligible !== false)
      .reduce((s, h) => s.add(D(h.principal).mul(D(h.share ?? 1))), ZERO);
    const other80c = Decimal.max(ZERO, D(inp.sec80cOther));
    const c80 = Decimal.min(CAP_80C, other80c.add(principal));
    loanChapter = c80.sub(Decimal.min(CAP_80C, other80c)).add(D(inp.eduInterest));
    chapter = c80.add(D(inp.sec80d)).add(Decimal.min(CAP_80CCD1B, D(inp.sec80ccd1b)))
      .add(D(inp.eduInterest)).add(D(inp.otherOldDeductions)).add(extraOld);
  }
  chapter = Decimal.min(chapter, grossTotal);
  const taxable = Decimal.max(ZERO, grossTotal.sub(chapter));
  return { taxable, tax: regimeTax(taxable, regime, inp.age), houseProperty: hp.used, chapterVIII: chapter, loanDeductions: hp.loanPart.add(loanChapter) };
}

export function compareRegimes(inp: RegimeInputs, hasBusinessIncome?: boolean): RegimeComparison {
  const old = side(inp, 'old');
  const nw = side(inp, 'new');
  const diff = nw.tax.sub(old.tax);
  const better = diff.abs().lt(1) ? 'same' : diff.gt(0) ? 'old' : 'new';
  const bare = side({ ...inp, homeLoans: [], eduInterest: 0 }, 'old');
  const loansWorth = bare.tax.sub(old.tax);
  let extra: Decimal | null = null;
  if (better === 'new') {
    let lo = ZERO;
    let hi = new Decimal(10_000_000);
    if (side(inp, 'old', hi).tax.lt(nw.tax)) {
      for (let i = 0; i < 60; i++) {
        const mid = lo.add(hi).div(2);
        if (side(inp, 'old', mid).tax.lt(nw.tax)) hi = mid;
        else lo = mid;
      }
      extra = hi.toDecimalPlaces(0, Decimal.ROUND_HALF_EVEN);
    }
  }
  const biz = hasBusinessIncome ?? D(inp.businessIncome).gt(0);
  return { old, new: nw, better, oldSaves: diff, loansWorthInOld: loansWorth, extraDeductionsForOldToWin: extra, switchRule: biz ? 'business_once' : 'yearly' };
}

/**
 * The switching rules in plain words (s.202(4) of the Income-tax Act 2025;
 * 1961: s.115BAC(6)). The new regime is the default.
 */
export function switchRuleText(rule: 'yearly' | 'business_once'): string {
  return rule === 'yearly'
    ? 'No business or professional income: you can pick either regime every year when you file your return (by the due date). Your employer deducts tax (TDS) by the regime you tell them in April; if that differs, the return settles it.'
    : 'You have business or professional income: leaving the new regime is a standing choice made in a return filed by the due date. It carries on in later years, you can come back to the new regime only once, and after that you can never leave it again unless the business income stops.';
}

/**
 * Year-1 interest and principal of a loan you might take, for a what-if
 * ("planning a home loan?"): the usual reducing-balance EMI, month by month.
 */
export function firstYearSplit(amount: Decimal.Value, annualRate: Decimal.Value, months: number): { interest: Decimal; principal: Decimal; emi: Decimal } {
  const P = D(amount);
  const r = D(annualRate).div(12);
  if (P.lte(0) || months <= 0) return { interest: ZERO, principal: ZERO, emi: ZERO };
  const emi = r.isZero() ? P.div(months) : P.mul(r).mul(r.add(1).pow(months)).div(r.add(1).pow(months).sub(1));
  let bal = P;
  let interest = ZERO;
  let principal = ZERO;
  for (let m = 0; m < Math.min(12, months); m++) {
    const i = bal.mul(r);
    const p = Decimal.min(bal, emi.sub(i));
    interest = interest.add(i);
    principal = principal.add(p);
    bal = bal.sub(p);
  }
  return { interest, principal, emi };
}
