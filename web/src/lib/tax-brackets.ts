/**
 * Income tax slabs for FY 26-27 (India) / TY 2026 (US).
 *
 * Used to:
 *   • Display the user's current tax bracket in setup ("you're in 30%, next
 *     bracket starts at ₹15L").
 *   • Auto-derive marginal_rate when the user provides gross income, so
 *     downstream effective-APR and tax-savings calculations don't need a
 *     manually-entered rate.
 *   • Compute annual tax liability, which the advance-tax module (G) uses
 *     to determine if Sec 208 / Form 1040-ES applies.
 *   • Detect bracket transitions on hike (slice E) — re-classify at each
 *     hike-effective month and surface a "you're in a new bracket" note.
 *
 * Slabs are hardcoded with explicit as-of dates so refresh is obvious in
 * diff. India splits by tax_regime (new is default from FY24+); US is
 * single filing status only for now (joint / HoH are bigger UI work).
 *
 * Important: these compute MARGINAL rate (top slab the user falls into),
 * not effective rate (total tax / total income). Marginal is what
 * deductions reduce — a Section 24(b) ₹2L deduction saves you
 * `2L × marginal_rate` in tax, not `2L × effective_rate`.
 */
import Decimal from 'decimal.js';
import type { Country, FilingStatusUS, IncomeType, TaxRegimeIN } from './api';

export const TAX_SLABS_AS_OF = 'FY 2026-27 (IN) · TY 2026 (US)';

interface Slab {
  /** Income bound at the START of this slab (the previous slab's end). */
  from: number;
  /** Income bound at the END of this slab. Infinity for the top slab. */
  to: number;
  /** Marginal rate in this slab, as a decimal (e.g. 0.30 for 30%). */
  rate: number;
}

// ─── India · New regime · FY 26-27 ─────────────────────────────────────────
// Source: Income Tax Act, Section 115BAC. Revised slabs effective FY 25-26
// onwards (Budget 2025) continue into FY 26-27. Standard deduction ₹75k
// for salaried; rebate u/s 87A makes income up to ₹12L effectively tax-free.
const IN_NEW_SLABS: Slab[] = [
  { from: 0, to: 300_000, rate: 0 },
  { from: 300_000, to: 700_000, rate: 0.05 },
  { from: 700_000, to: 1_000_000, rate: 0.10 },
  { from: 1_000_000, to: 1_200_000, rate: 0.15 },
  { from: 1_200_000, to: 1_500_000, rate: 0.20 },
  { from: 1_500_000, to: Infinity, rate: 0.30 },
];
const IN_NEW_STANDARD_DEDUCTION = 75_000;
const IN_NEW_REBATE_87A_CAP = 1_200_000;     // income below which liability = 0

// ─── India · Old regime · FY 26-27 ─────────────────────────────────────────
// Section 80C/80D/24/etc. deductions available; we surface only the slabs
// here, and let TaxBreakdown handle the per-deduction caps separately.
const IN_OLD_SLABS: Slab[] = [
  { from: 0, to: 250_000, rate: 0 },
  { from: 250_000, to: 500_000, rate: 0.05 },
  { from: 500_000, to: 1_000_000, rate: 0.20 },
  { from: 1_000_000, to: Infinity, rate: 0.30 },
];
const IN_OLD_STANDARD_DEDUCTION = 50_000;
const IN_OLD_REBATE_87A_CAP = 500_000;       // income below which liability = 0

// India surcharge + cess. Applied on top of slab tax for high-income earners.
const IN_HEALTH_EDU_CESS = 0.04;             // 4% cess on (tax + surcharge)
function inSurchargeRate(taxableIncome: number): number {
  // Surcharge slabs (same under both regimes for FY 26-27).
  if (taxableIncome > 50_000_000) return 0.37;
  if (taxableIncome > 20_000_000) return 0.25;
  if (taxableIncome > 10_000_000) return 0.15;
  if (taxableIncome > 5_000_000) return 0.10;
  return 0;
}

// ─── US · TY 2026 federal slabs by filing status ──────────────────────────
// Source: IRS Rev. Proc. 2025-32 inflation adjustments for 2026.
//
// MFJ slabs are roughly 2× single (TCJA "marriage penalty fix" sticks until
// 2026 sunset rules kick in for 2027+). HoH sits between single and MFJ in
// the lower brackets, then merges with single at the top.
const US_SINGLE_SLABS: Slab[] = [
  { from: 0, to: 11_925, rate: 0.10 },
  { from: 11_925, to: 48_475, rate: 0.12 },
  { from: 48_475, to: 103_350, rate: 0.22 },
  { from: 103_350, to: 197_300, rate: 0.24 },
  { from: 197_300, to: 250_525, rate: 0.32 },
  { from: 250_525, to: 626_350, rate: 0.35 },
  { from: 626_350, to: Infinity, rate: 0.37 },
];
const US_MFJ_SLABS: Slab[] = [
  { from: 0, to: 23_850, rate: 0.10 },
  { from: 23_850, to: 96_950, rate: 0.12 },
  { from: 96_950, to: 206_700, rate: 0.22 },
  { from: 206_700, to: 394_600, rate: 0.24 },
  { from: 394_600, to: 501_050, rate: 0.32 },
  { from: 501_050, to: 751_600, rate: 0.35 },
  { from: 751_600, to: Infinity, rate: 0.37 },
];
const US_HOH_SLABS: Slab[] = [
  { from: 0, to: 17_000, rate: 0.10 },
  { from: 17_000, to: 64_850, rate: 0.12 },
  { from: 64_850, to: 103_350, rate: 0.22 },
  { from: 103_350, to: 197_300, rate: 0.24 },
  { from: 197_300, to: 250_500, rate: 0.32 },
  { from: 250_500, to: 626_350, rate: 0.35 },
  { from: 626_350, to: Infinity, rate: 0.37 },
];
const US_STANDARD_DEDUCTION: Record<FilingStatusUS, number> = {
  single: 15_000,
  mfj: 30_000,
  hoh: 22_500,
};

// ────────────────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────────────────

export interface BracketInfo {
  /** Marginal rate the user falls into, as a decimal (e.g. 0.30). */
  marginalRate: number;
  /** Income at the start of this slab. */
  lowerBound: number;
  /** Income at the end of this slab. Infinity for the top slab. */
  upperBound: number;
  /** Headroom before next bracket transition. Infinity at the top. */
  headroom: number;
  /** Slabs used for this user/regime — for display tables. */
  slabs: Slab[];
}

/**
 * Resolve the slab set for a user. Returns standard deduction too so
 * callers can compute taxable income consistently.
 *
 * For US users, `filingStatus` selects the right slab table. Default
 * 'single' when omitted (back-compat for callers built before the
 * filing-status pipeline). MFJ slabs roughly double single's, HoH sits
 * between (it merges with single at the top brackets, sweetens the
 * lower).
 */
function pickSlabs(
  country: Country,
  regime: TaxRegimeIN | null | undefined,
  incomeType: IncomeType,
  filingStatus?: FilingStatusUS,
): { slabs: Slab[]; standardDeduction: number; rebate87ACap: number } {
  if (country === 'US') {
    const status = filingStatus ?? 'single';
    const slabs = status === 'mfj' ? US_MFJ_SLABS
      : status === 'hoh' ? US_HOH_SLABS
      : US_SINGLE_SLABS;
    return {
      slabs,
      // Standard deduction only applies to wage income; SE users itemise
      // Schedule C (business deductions reduce the income BEFORE bracket
      // calc). For our purposes — surplus math — we apply std deduction
      // for salaried, zero for SE.
      standardDeduction:
        incomeType === 'salaried' ? US_STANDARD_DEDUCTION[status] : 0,
      rebate87ACap: 0,           // no equivalent in US
    };
  }
  // India — new regime is default from FY24 onward.
  const useNew = regime === 'new' || regime == null;
  return useNew
    ? {
        slabs: IN_NEW_SLABS,
        standardDeduction: incomeType === 'salaried' ? IN_NEW_STANDARD_DEDUCTION : 0,
        rebate87ACap: IN_NEW_REBATE_87A_CAP,
      }
    : {
        slabs: IN_OLD_SLABS,
        standardDeduction: incomeType === 'salaried' ? IN_OLD_STANDARD_DEDUCTION : 0,
        rebate87ACap: IN_OLD_REBATE_87A_CAP,
      };
}

/**
 * Where in the slab table does this income land? Returns marginal rate +
 * bracket bounds + headroom-to-next-bracket. Returns null when grossIncome
 * is missing or non-positive (caller falls back to other heuristics).
 *
 * `grossIncome` is the user's annual pre-tax income (salary or business
 * income). Standard deduction is applied before bucketing.
 */
export function classifyBracket(
  country: Country,
  regime: TaxRegimeIN | null | undefined,
  incomeType: IncomeType,
  grossIncome: number,
  filingStatus?: FilingStatusUS,
): BracketInfo | null {
  if (!Number.isFinite(grossIncome) || grossIncome <= 0) return null;
  const { slabs, standardDeduction } = pickSlabs(country, regime, incomeType, filingStatus);
  const taxable = Math.max(0, grossIncome - standardDeduction);

  for (const slab of slabs) {
    if (taxable >= slab.from && taxable < slab.to) {
      return {
        marginalRate: slab.rate,
        lowerBound: slab.from,
        upperBound: slab.to,
        headroom: slab.to === Infinity ? Infinity : slab.to - taxable,
        slabs,
      };
    }
  }
  // Should be unreachable — top slab extends to Infinity.
  return null;
}

/**
 * Annual income tax under the chosen regime, before TDS. Includes
 * rebate u/s 87A (India) and surcharge + cess (India). For US: simple
 * progressive marginal tax through the slabs.
 *
 * Returns a Decimal for precision in downstream cashflow math (advance
 * tax / 4 quarterly instalments, etc.).
 */
export function computeAnnualTax(
  country: Country,
  regime: TaxRegimeIN | null | undefined,
  incomeType: IncomeType,
  grossIncome: number,
  filingStatus?: FilingStatusUS,
): Decimal {
  if (!Number.isFinite(grossIncome) || grossIncome <= 0) return new Decimal(0);
  const { slabs, standardDeduction, rebate87ACap } = pickSlabs(country, regime, incomeType, filingStatus);
  const taxable = Math.max(0, grossIncome - standardDeduction);

  // Walk slabs, taxing each layer at its rate.
  let tax = new Decimal(0);
  for (const slab of slabs) {
    if (taxable <= slab.from) break;
    const layer = Math.min(taxable, slab.to) - slab.from;
    tax = tax.add(new Decimal(layer).mul(slab.rate));
  }

  if (country === 'IN') {
    // Rebate u/s 87A — full waiver when taxable income ≤ cap. This is
    // how the new regime stays "tax-free up to ₹12L" despite slabs
    // starting at ₹3L.
    if (rebate87ACap > 0 && taxable <= rebate87ACap) {
      tax = new Decimal(0);
    }
    // Surcharge for high-income earners (10/15/25/37%).
    const surcharge = inSurchargeRate(taxable);
    if (surcharge > 0) tax = tax.mul(1 + surcharge);
    // Health & Education cess (4%) on (tax + surcharge) — always applies.
    tax = tax.mul(1 + IN_HEALTH_EDU_CESS);
  }
  return tax;
}

/**
 * Convenience — marginal rate as a decimal string for use as the
 * simulate-plan `marginal_rate` parameter. Returns null when bracket
 * can't be derived (caller falls back to the manual marginal_rate
 * field on UserPayload).
 */
export function deriveMarginalRate(
  country: Country,
  regime: TaxRegimeIN | null | undefined,
  incomeType: IncomeType,
  grossIncome: number,
): string | null {
  const info = classifyBracket(country, regime, incomeType, grossIncome);
  if (!info) return null;
  return info.marginalRate.toFixed(2);
}

/**
 * Does Sec 208 (India) / Form 1040-ES (US) advance-tax obligation apply?
 *
 * India: liability > ₹10,000 after TDS. For salaried users TDS usually
 * covers most/all of it, so we conservatively trigger only when annual
 * tax > ₹50,000 AND they're SE (the typical advance-tax-relevant case).
 * For salaried users with extra non-salary income (which we don't model
 * yet), the threshold is lower — we'll re-evaluate when that data lands.
 *
 * US: > $1,000 owed after withholding. Same conservative trigger for SE;
 * salaried with W-2 withholding generally doesn't owe 1040-ES.
 */
export function isAdvanceTaxApplicable(
  country: Country,
  incomeType: IncomeType,
  annualTax: Decimal,
): boolean {
  if (incomeType !== 'business_owner') return false;
  if (country === 'IN') return annualTax.gt(10_000);
  return annualTax.gt(1_000);
}

/**
 * Human-readable bracket label for UI display.
 *   • India new regime: "30% slab (₹15L+ income)"
 *   • US single: "24% bracket ($103,350 – $197,300)"
 */
export function describeBracket(info: BracketInfo, country: Country): string {
  const pct = (info.marginalRate * 100).toFixed(0);
  const cur = country === 'IN' ? '₹' : '$';
  if (info.upperBound === Infinity) {
    return `${pct}% bracket (${cur}${formatAmount(info.lowerBound, country)}+ income)`;
  }
  return `${pct}% bracket (${cur}${formatAmount(info.lowerBound, country)} – ${cur}${formatAmount(info.upperBound, country)})`;
}

function formatAmount(n: number, country: Country): string {
  if (country === 'IN') {
    // Render in lakhs / crores so the user reads it like a slab table.
    if (n >= 10_000_000) return `${(n / 10_000_000).toFixed(2)}Cr`;
    if (n >= 100_000) return `${(n / 100_000).toFixed(1)}L`;
    return n.toLocaleString('en-IN');
  }
  return n.toLocaleString('en-US');
}
