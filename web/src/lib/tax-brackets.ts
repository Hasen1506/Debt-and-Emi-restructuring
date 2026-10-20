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
import type { AgeBracket, Country, FilingStatusUS, IncomeType, TaxRegimeIN } from './api';
import TAX from './tax-tables.json';
import { usSelfEmploymentTax } from './us-self-employment';

export const TAX_SLABS_AS_OF = TAX.as_of;

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
// One source: the engine's tables, exported by
// scripts/export_tax_tables.py. The copies that used to live here were
// labelled FY 2026-27 but held the 2024 India slabs and 2025 US figures.
type SlabRows = Array<[number | null, number]>;
function toSlabs(rows: SlabRows): Slab[] {
  let from = 0;
  return rows.map(([limit, rate]) => {
    const to = limit ?? Infinity;
    const slab = { from, to, rate };
    from = to;
    return slab;
  });
}

const IN_NEW_SLABS: Slab[] = toSlabs(TAX.in.new.slabs as SlabRows);
const IN_NEW_STANDARD_DEDUCTION = TAX.in.new.standard_deduction;
const IN_NEW_REBATE_87A_CAP = TAX.in.new.rebate_87a.threshold; // income below which liability = 0

const IN_OLD_SLABS: Slab[] = toSlabs(TAX.in.old.slabs as SlabRows);
// Round 3 (n13pension): the old regime's senior tables (60-79, 80+), from the
// engine (Finance Act 2026 First Schedule Part I-B; incometax.gov.in "Salaried
// Individuals for AY 2026-27", read 17 Oct 2026). The new regime has one table.
const IN_OLD_60_79: Slab[] = toSlabs(TAX.in.old_60_79.slabs as SlabRows);
const IN_OLD_80_PLUS: Slab[] = toSlabs(TAX.in.old_80_plus.slabs as SlabRows);
const oldSlabs = (age?: AgeBracket) => (age === '80_plus' ? IN_OLD_80_PLUS : age === '60_plus' ? IN_OLD_60_79 : IN_OLD_SLABS);
const IN_OLD_STANDARD_DEDUCTION = TAX.in.old.standard_deduction;
const IN_OLD_REBATE_87A_CAP = TAX.in.old.rebate_87a.threshold; // income below which liability = 0

const IN_HEALTH_EDU_CESS = TAX.in.cess;      // cess on (tax + surcharge)
const IN_SURCHARGE: Slab[] = toSlabs(TAX.in.surcharge as SlabRows);
/** Surcharge rate for the band. The new regime caps it at 25% (no 37%
 *  band, Finance Act 2023), as engine/tax/india.py `surcharge_rate`. */
export function inSurchargeRate(taxableIncome: number, regime?: TaxRegimeIN): number {
  const rate = IN_SURCHARGE.find((b) => taxableIncome <= b.to)?.rate ?? 0;
  return regime === 'new' ? Math.min(rate, TAX.in.surcharge_cap_new_regime) : rate;
}

const US_SINGLE_SLABS: Slab[] = toSlabs(TAX.us.single.slabs as SlabRows);
const US_MFJ_SLABS: Slab[] = toSlabs(TAX.us.mfj.slabs as SlabRows);
const US_HOH_SLABS: Slab[] = toSlabs(TAX.us.hoh.slabs as SlabRows);
const US_MFS_SLABS: Slab[] = toSlabs(TAX.us.mfs.slabs as SlabRows);   // C17
export const US_STANDARD_DEDUCTION: Record<FilingStatusUS, number> = {
  single: TAX.us.single.standard_deduction,
  mfj: TAX.us.mfj.standard_deduction,
  hoh: TAX.us.hoh.standard_deduction,
  mfs: TAX.us.mfs.standard_deduction,
};

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
  age?: AgeBracket,
): { slabs: Slab[]; standardDeduction: number; rebate87ACap: number } {
  if (country === 'US') {
    const status = filingStatus ?? 'single';
    const slabs = status === 'mfj' ? US_MFJ_SLABS
      : status === 'hoh' ? US_HOH_SLABS
      : status === 'mfs' ? US_MFS_SLABS
      : US_SINGLE_SLABS;
    return {
      slabs,
      // Standard deduction only applies to wage income; SE users itemise
      // Schedule C (business deductions reduce the income BEFORE bracket
      // calc). For our purposes — surplus math — we apply std deduction
      // for salaried, zero for SE.
      // Every US filer gets the standard deduction, not just employees.
      standardDeduction: US_STANDARD_DEDUCTION[status],
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
        slabs: oldSlabs(age),
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
    if (taxable >= slab.from && taxable <= slab.to) {
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
  age?: AgeBracket,
): Decimal {
  if (!Number.isFinite(grossIncome) || grossIncome <= 0) return new Decimal(0);
  const { standardDeduction } = pickSlabs(country, regime, incomeType, filingStatus, age);
  const taxable = Math.max(0, grossIncome - standardDeduction);
  if (country === 'IN') return incomeTaxIN(taxable, regime === 'old' ? 'old' : 'new', age);
  if (incomeType !== 'business_owner') return federalTaxUS(taxable, filingStatus ?? 'single');
  // Round 3 (u08gig): self-employed, income tax after half the SE tax, plus the SE tax.
  const [se, half] = usSelfEmploymentTax(grossIncome, filingStatus);
  return federalTaxUS(Math.max(0, taxable - half), filingStatus ?? 'single').add(se);
}

function slabTax(taxable: number, slabs: Slab[]): Decimal {
  let tax = new Decimal(0);
  for (const slab of slabs) {
    if (taxable <= slab.from) break;
    const layer = Math.min(taxable, slab.to) - slab.from;
    tax = tax.add(new Decimal(layer).mul(slab.rate));
  }
  return tax;
}

/** India tax on taxable income, as engine/tax/india.py `income_tax`:
 *  slab tax, less the 87A rebate, plus surcharge, plus 4% cess. */
function taxBeforeSurchargeIN(taxable: number, regime: TaxRegimeIN, age?: AgeBracket): Decimal {
  const t = regime === 'old' ? TAX.in.old : TAX.in.new;
  let tax = slabTax(taxable, regime === 'old' ? oldSlabs(age) : IN_NEW_SLABS);
  if (taxable <= t.rebate_87a.threshold) {
    tax = Decimal.max(0, tax.minus(t.rebate_87a.max));
  } else if (regime !== 'old') {
    // Marginal relief (new regime), as the engine: just above the ₹12L
    // line the tax can't exceed the income above it.
    tax = Decimal.min(tax, taxable - t.rebate_87a.threshold);
  }
  return Decimal.max(0, tax);
}

/** Surcharge band floors (₹50L / ₹1Cr / ₹2Cr / ₹5Cr). */
const IN_SURCHARGE_THRESHOLDS = IN_SURCHARGE.slice(0, -1).map((b) => b.to);

export function incomeTaxIN(taxable: number, regime: TaxRegimeIN, age?: AgeBracket): Decimal {
  const tax = taxBeforeSurchargeIN(taxable, regime, age);
  if (tax.lte(0)) return new Decimal(0);
  const rate = inSurchargeRate(taxable, regime);
  let withSurcharge = tax.mul(1 + rate);
  // Surcharge marginal relief: just above a threshold, tax + surcharge
  // can't exceed the tax at the threshold plus the income above it.
  const below = IN_SURCHARGE_THRESHOLDS.filter((t) => t < taxable);
  if (below.length && rate > 0) {
    const t = below[below.length - 1];
    const atT = taxBeforeSurchargeIN(t, regime, age).mul(1 + inSurchargeRate(t, regime));
    withSurcharge = Decimal.min(withSurcharge, atT.add(taxable - t));
  }
  return withSurcharge.mul(1 + IN_HEALTH_EDU_CESS);
}

/** US federal tax on taxable income (no state). */
export function federalTaxUS(taxable: number, filing: FilingStatusUS): Decimal {
  const slabs = filing === 'mfj' ? US_MFJ_SLABS : filing === 'hoh' ? US_HOH_SLABS : filing === 'mfs' ? US_MFS_SLABS : US_SINGLE_SLABS;
  return slabTax(taxable, slabs);
}

/** India marginal rate as engine/tax/india.py `marginal_rate`:
 *  slab rate × (1 + surcharge) × (1 + cess), and 0 at or below the 87A
 *  line, where the rebate cancels the tax. */
export function marginalRateIN(taxable: number, regime: TaxRegimeIN, age?: AgeBracket): number {
  const t = regime === 'old' ? TAX.in.old : TAX.in.new;
  if (taxable <= t.rebate_87a.threshold) return 0;
  const slabs = regime === 'old' ? oldSlabs(age) : IN_NEW_SLABS;
  const slab = slabs.find((s) => taxable <= s.to) ?? slabs[slabs.length - 1];
  return slab.rate * (1 + inSurchargeRate(taxable, regime)) * (1 + IN_HEALTH_EDU_CESS);
}

/** US federal marginal rate. */
export function marginalRateUS(taxable: number, filing: FilingStatusUS): number {
  const slabs = filing === 'mfj' ? US_MFJ_SLABS : filing === 'hoh' ? US_HOH_SLABS : filing === 'mfs' ? US_MFS_SLABS : US_SINGLE_SLABS;
  return (slabs.find((s) => taxable <= s.to) ?? slabs[slabs.length - 1]).rate;
}

/**
 * Does Sec 208 (India) / Form 1040-ES (US) advance-tax obligation apply?
 *
 * India: liability of ₹10,000 or more after TDS (business income here).
 * Salaried users with non-TDS income (interest, gains, rent, freelance)
 * are worked out by the engine instead (lib/salaried-advance-tax,
 * POST /api/tax/advance-tax/salaried).
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
  // s.404 [208]: "Rs. 10,000 or more" (Income Tax Dept FAQ); was > 10,000.
  if (country === 'IN') return annualTax.gte(10_000);
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

/**
 * The India new-regime slabs as lines for a popover, read from the same
 * engine table the plan uses (UX50 C-18: the Profile tooltip was hand-typed
 * with the old 12–15 / 15–20 / 30%-above-20 lakh slabs).
 */
export function inNewRegimeSlabLines(): string[] {
  return IN_NEW_SLABS.map((s) => {
    const pct = `${Math.round(s.rate * 1000) / 10}%`;
    const lakh = (n: number) => String(Math.round((n / 1e5) * 100) / 100);
    if (s.to === Infinity) return `Above ₹${lakh(s.from)} lakh: ${pct}`;
    return `₹${lakh(s.from)}–${lakh(s.to)} lakh: ${pct}`;
  });
}

/** The tax year the tables are for, as /tax names it ("2026-27"). */
export const IN_TAX_YEAR_LABEL = 'tax year 2026-27';

/** UX walkthrough fix 23: the rate a saved profile carries from gross pay.
 *  India: the slab with surcharge and 4% cess, 0 inside the 87A rebate
 *  (marginalRateIN, as the engine), so a 30% slab saves 0.312, not 0.30;
 *  US: the federal bracket. Null without gross pay. */
export function grossMarginalRate(
  country: Country, regime: TaxRegimeIN | null | undefined, incomeType: IncomeType, grossIncome: number, filingStatus?: FilingStatusUS,
): number | null {
  const b = classifyBracket(country, regime, incomeType, grossIncome, filingStatus);
  if (!b) return null;
  if (country !== 'IN') return b.marginalRate;
  const { standardDeduction } = pickSlabs(country, regime, incomeType, filingStatus);
  return marginalRateIN(Math.max(0, grossIncome - standardDeduction), regime === 'old' ? 'old' : 'new');
}
