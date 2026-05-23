/**
 * Tax deductions — input capture + derived marginal-rate computation.
 *
 * Lives entirely client-side today. The engine still consumes a flat
 * `marginal_rate`, but Setup uses these inputs to derive a more accurate
 * rate before it's stored, and the tax-breakdown panel can render the
 * actual deductions taken instead of a hand-wave.
 *
 * IN handling:
 *   • Only relevant when tax_regime === 'old'. New-regime users see
 *     zero deductions — the regime trades them for cleaner slabs.
 *   • Statutory caps applied at compute time:
 *     - 80C: ₹1.5L
 *     - 80D: ₹25k (default; ₹50k if user is 60+ — captured via age_bracket)
 *     - 80CCD(1B): ₹50k
 *     - 80E: no cap (full interest deductible)
 *     - HRA: user enters the post-cap claim (we don't reproduce the
 *       least-of-three rule here; capturing the final claim is simpler
 *       and matches what the user files).
 *     - 24b: home-loan interest, handled separately in effective-apr.ts
 *
 * US handling:
 *   • Itemize-vs-standard auto-switch: if mortgage_interest + other_itemized
 *     beats the standard deduction, we use the higher value. Standard
 *     deduction values are 2026 estimates.
 *   • State tax adds to federal marginal — `state_marginal_rate` (already
 *     on UserPayload) is the default; `deductions.state_marginal_rate_override`
 *     wins when set.
 */
import Decimal from 'decimal.js';
import type { AgeBracket, Country, DeductionsPayload, FilingStatusUS, TaxRegimeIN, UserPayload } from './api';
import { activeSlabGrossAnnual } from './income-streams';

const D = (v: string | number | Decimal | null | undefined) =>
  new Decimal(v ?? '0');

// India statutory caps (FY25/AY26)
const CAP_80C = D('150000');
const CAP_80D_DEFAULT = D('25000');
const CAP_80D_SENIOR = D('50000');
const CAP_80CCD_1B = D('50000');
// Standard deduction for salaried filers — auto-applied, not part of
// the user-entered deductions payload. Old regime stays at ₹50k; new
// regime was raised to ₹75k from FY24-25 onwards. Most users will
// have some salaried income; freelancers / business-only filers
// over-claim slightly via this line but the bracket distortion is
// smaller than not applying it at all (which over-stated marginal
// rate for everyone).
const STD_DEDUCTION_OLD = D('50000');
const STD_DEDUCTION_NEW = D('75000');

// US standard deduction for FY2026 (approx — IRS releases yearly)
const US_STD_DEDUCTION: Record<FilingStatusUS, Decimal> = {
  single: D('14600'),
  mfj: D('29200'),
  hoh: D('21900'),
};

function get80DCap(ageBracket?: AgeBracket): Decimal {
  return ageBracket === '50_plus' ? CAP_80D_SENIOR : CAP_80D_DEFAULT;
}

export interface DeductionLine {
  label: string;
  claimed: Decimal;
  allowed: Decimal;
  note?: string;
}

export interface DeductionsSummary {
  lines: DeductionLine[];
  totalAllowed: Decimal;
  /** Sum of *claimed* (pre-cap) inputs — useful for an over-claim warning. */
  totalClaimed: Decimal;
}

/**
 * Apply statutory caps and return the line-by-line breakdown of allowed
 * deductions. Returns an empty list for IN-new regime users (no deductions).
 */
export function summariseDeductions(
  deductions: DeductionsPayload | undefined,
  country: Country,
  taxRegime: TaxRegimeIN | undefined,
  ageBracket: AgeBracket | undefined,
): DeductionsSummary {
  const ded = deductions ?? {};
  const lines: DeductionLine[] = [];

  if (country === 'IN') {
    const isOld = taxRegime === 'old';
    // Standard deduction applies in both regimes for salaried filers.
    // Auto-applied here so the marginal-rate calc reflects what the
    // user actually owes; without it, a salaried user at ₹15L gross
    // was being put in the 30% slab when their actual taxable
    // (₹15L - ₹75k) lands in 20%.
    const stdDed = isOld ? STD_DEDUCTION_OLD : STD_DEDUCTION_NEW;
    lines.push({
      label: 'Standard deduction',
      claimed: stdDed,
      allowed: stdDed,
      note: 'Auto-applied for salaried filers',
    });
    if (!isOld) {
      // New regime: only the standard deduction (plus employer-NPS
      // 80CCD(2), not currently captured). All other 80-series items
      // are unavailable on this regime by design.
      const totalAllowed = lines.reduce((s, l) => s.plus(l.allowed), D(0));
      const totalClaimed = lines.reduce((s, l) => s.plus(l.claimed), D(0));
      return { lines, totalAllowed, totalClaimed };
    }
    const hraClaim = D(ded.hra_claim_annual);
    if (hraClaim.gt(0)) {
      lines.push({
        label: 'HRA exemption',
        claimed: hraClaim,
        allowed: hraClaim,
        note: "User-entered final claim (after least-of-three)",
      });
    }
    const sec80c = D(ded.sec_80c_annual);
    if (sec80c.gt(0)) {
      lines.push({
        label: '80C investments',
        claimed: sec80c,
        allowed: Decimal.min(sec80c, CAP_80C),
        note: sec80c.gt(CAP_80C) ? 'Capped at ₹1.5L' : undefined,
      });
    }
    const sec80d = D(ded.sec_80d_annual);
    if (sec80d.gt(0)) {
      const cap = get80DCap(ageBracket);
      lines.push({
        label: '80D health insurance',
        claimed: sec80d,
        allowed: Decimal.min(sec80d, cap),
        note: sec80d.gt(cap)
          ? `Capped at ₹${cap.toFixed(0)} for your age`
          : undefined,
      });
    }
    const sec80e = D(ded.sec_80e_annual);
    if (sec80e.gt(0)) {
      lines.push({
        label: '80E education-loan interest',
        claimed: sec80e,
        allowed: sec80e,
        note: 'No cap — interest fully deductible for 8 years',
      });
    }
    const sec80ccd = D(ded.sec_80ccd1b_annual);
    if (sec80ccd.gt(0)) {
      lines.push({
        label: '80CCD(1B) NPS top-up',
        claimed: sec80ccd,
        allowed: Decimal.min(sec80ccd, CAP_80CCD_1B),
        note: sec80ccd.gt(CAP_80CCD_1B) ? 'Capped at ₹50k' : undefined,
      });
    }
  } else {
    // US: itemize-vs-standard. Always shows the higher of the two.
    const mortgage = D(ded.mortgage_interest_annual);
    const other = D(ded.itemized_deductions_other);
    const itemizedTotal = mortgage.plus(other);
    // Standard deduction needs filing_status; default to 'single' if missing.
    // We don't have filing_status as an argument here; the caller passes it
    // through `summariseDeductionsUS` with explicit filing status.
    // For now, return the itemized lines if either is > 0; the comparison
    // to the standard deduction happens in `summariseDeductionsUS`.
    if (mortgage.gt(0)) {
      lines.push({
        label: 'Mortgage interest (IRC §163)',
        claimed: mortgage,
        allowed: mortgage,
      });
    }
    if (other.gt(0)) {
      lines.push({
        label: 'Other itemized (SALT, charity, etc.)',
        claimed: other,
        allowed: other,
        note: 'SALT cap of $10k applied by user; we trust the input',
      });
    }
    // Push a "vs standard" comparator note via the consumer.
    if (lines.length > 0) {
      lines.push({
        label: 'Itemized total',
        claimed: itemizedTotal,
        allowed: itemizedTotal,
        note: 'Use this only if it beats your standard deduction',
      });
    }
  }

  const totalAllowed = lines.reduce(
    (s, l) => s.plus(l.allowed),
    D(0),
  );
  const totalClaimed = lines.reduce(
    (s, l) => s.plus(l.claimed),
    D(0),
  );

  return { lines, totalAllowed, totalClaimed };
}

/**
 * Pick the higher of itemized vs standard for US users. Returns the
 * effective deduction amount that should be applied against gross.
 */
export function pickUSDeduction(
  deductions: DeductionsPayload | undefined,
  filingStatus: FilingStatusUS | undefined,
): { effective: Decimal; uses: 'itemized' | 'standard'; standard: Decimal; itemized: Decimal } {
  const std = US_STD_DEDUCTION[filingStatus ?? 'single'] ?? US_STD_DEDUCTION.single;
  const mortgage = D(deductions?.mortgage_interest_annual);
  const other = D(deductions?.itemized_deductions_other);
  const itemized = mortgage.plus(other);
  if (itemized.gt(std)) {
    return { effective: itemized, uses: 'itemized', standard: std, itemized };
  }
  return { effective: std, uses: 'standard', standard: std, itemized };
}

/**
 * Lightweight derived marginal rate. NOT a full tax calc — we apply
 * deductions against gross to estimate taxable income, then look up the
 * bracket. The user's `marginal_rate` field remains the authoritative
 * input; this helper produces a derived value so Setup can show "based
 * on your inputs, your marginal is ~X%".
 *
 * Returns null when we don't have enough info (no gross income, missing
 * filing status, etc.) — callers should fall back to the user's manual
 * marginal_rate.
 */
export function deriveMarginalRate(args: {
  grossAnnual: Decimal | string | number | null | undefined;
  country: Country;
  taxRegime?: TaxRegimeIN;
  filingStatus?: FilingStatusUS;
  deductions?: DeductionsPayload;
  ageBracket?: AgeBracket;
  /** State marginal rate on the user payload (US only). */
  stateMarginalRate?: string;
}): Decimal | null {
  const gross = D(args.grossAnnual);
  if (gross.lte(0)) return null;

  let taxable = gross;
  if (args.country === 'IN') {
    const summary = summariseDeductions(
      args.deductions,
      'IN',
      args.taxRegime,
      args.ageBracket,
    );
    taxable = Decimal.max(gross.minus(summary.totalAllowed), D(0));
    return marginalIN(taxable, args.taxRegime ?? 'new');
  }

  const { effective } = pickUSDeduction(args.deductions, args.filingStatus);
  taxable = Decimal.max(gross.minus(effective), D(0));
  const fed = marginalUS(taxable, args.filingStatus ?? 'single');
  const stateOverride = D(args.deductions?.state_marginal_rate_override);
  const state =
    stateOverride.gt(0) ? stateOverride : D(args.stateMarginalRate);
  return fed.plus(state);
}

/**
 * Adapter that pulls the inputs `deriveMarginalRate` needs straight off
 * a `UserPayload`. Used by callers that mutate user fields (lifecycle
 * events, onboarding save) and want to refresh the stored marginal
 * rate to match. Returns a decimal string ready for
 * `StoredProfile.marginalRate`. Falls back to `'0'` when there's no
 * income signal — callers can keep the existing stored value instead.
 *
 * Gross income source:
 *   1. `income_streams` (preferred — captures presumptive / rental /
 *      capital-gains splits properly via `activeSlabGrossAnnual`).
 *   2. `annual_income` (the engine field — used when streams are absent).
 */
export function deriveMarginalRateForUser(user: UserPayload): string {
  const slabFromStreams = user.income_streams && user.income_streams.length > 0
    ? activeSlabGrossAnnual(user.income_streams)
    : D(0);
  // Fall back to annual_income only when streams aren't configured —
  // capital-gains splits live in streams, not on the scalar field.
  const grossAnnual = slabFromStreams.gt(0)
    ? slabFromStreams
    : D(user.annual_income);
  if (grossAnnual.lte(0)) return '0';
  const derived = deriveMarginalRate({
    grossAnnual,
    country: user.country,
    taxRegime: user.tax_regime,
    filingStatus: user.filing_status,
    deductions: user.deductions,
    ageBracket: user.age_bracket,
    stateMarginalRate: user.state_marginal_rate,
  });
  return derived?.toString() ?? '0';
}

// ─── Bracket tables + shared walkers ───────────────────────────────────────
// These mirror engine/country_data.py bracket structures at a coarse level.
// We don't need surgical accuracy — these power the Setup "derived marginal"
// preview and the deduction-saving calc, not the actual tax sleeve math.
//
// Tables are listed as `[upper_bound_inclusive, rate]`. Use `Infinity` for
// the top slab. The shared walkers handle both marginal lookup and total-
// tax integration, so the two stay in lock-step when brackets are edited.

type Bracket = [upperBound: number, rate: string];

const IN_NEW_BRACKETS: Bracket[] = [
  [300000, '0'],
  [700000, '0.05'],
  [1000000, '0.10'],
  [1200000, '0.15'],
  [1500000, '0.20'],
  [Infinity, '0.30'],
];

const IN_OLD_BRACKETS: Bracket[] = [
  [250000, '0'],
  [500000, '0.05'],
  [1000000, '0.20'],
  [Infinity, '0.30'],
];

const US_MFJ_BRACKETS: Bracket[] = [
  [23200, '0.10'],
  [94300, '0.12'],
  [201050, '0.22'],
  [383900, '0.24'],
  [487450, '0.32'],
  [731200, '0.35'],
  [Infinity, '0.37'],
];

const US_SINGLE_BRACKETS: Bracket[] = [
  [11600, '0.10'],
  [47150, '0.12'],
  [100525, '0.22'],
  [191950, '0.24'],
  [243725, '0.32'],
  [609350, '0.35'],
  [Infinity, '0.37'],
];

/** Marginal rate at a given taxable income — picks the bracket whose
 *  upper bound the income falls into. */
function marginalForBrackets(taxable: Decimal, brackets: Bracket[]): Decimal {
  const t = taxable.toNumber();
  for (const [bound, rate] of brackets) {
    if (t <= bound) return D(rate);
  }
  return D(brackets[brackets.length - 1][1]);
}

/** Total tax owed on a given taxable income — sums the rate-weighted
 *  width of every slab the income reaches. */
function totalTaxForBrackets(taxable: Decimal, brackets: Bracket[]): Decimal {
  let tax = D(0);
  let prevBound = 0;
  const t = taxable.toNumber();
  if (t <= 0) return tax;
  for (const [bound, rate] of brackets) {
    const slabWidth = Math.min(t, bound) - prevBound;
    if (slabWidth <= 0) break;
    tax = tax.plus(D(slabWidth).mul(rate));
    prevBound = bound;
    if (t <= bound) break;
  }
  return tax;
}

function bracketsIN(regime: TaxRegimeIN): Bracket[] {
  return regime === 'new' ? IN_NEW_BRACKETS : IN_OLD_BRACKETS;
}

function bracketsUS(filing: FilingStatusUS): Bracket[] {
  return filing === 'mfj' ? US_MFJ_BRACKETS : US_SINGLE_BRACKETS;
}

function marginalIN(taxable: Decimal, regime: TaxRegimeIN): Decimal {
  return marginalForBrackets(taxable, bracketsIN(regime));
}

function marginalUS(taxable: Decimal, filing: FilingStatusUS): Decimal {
  return marginalForBrackets(taxable, bracketsUS(filing));
}

/**
 * Tax saving from applying an additional deduction on top of the user's
 * existing taxable income. Computed exactly as `tax(taxable) − tax(taxable
 * − deduction)`, which walks across slab boundaries the deduction spans.
 *
 * Why this exists instead of `deduction × marginalRate`:
 *   • Marginal rate × deduction is correct only when the entire deduction
 *     sits inside a single slab.
 *   • A deduction that crosses a slab boundary partially saves at the
 *     higher rate and partially at the lower — the marginal-rate
 *     approximation over-counts.
 *
 * Example (IN old regime, taxable ₹11L, deduction ₹2L):
 *   • Marginal at ₹11L = 30%. Naive: ₹2L × 30% = ₹60k saved.
 *   • Bracket walk: reducing to ₹9L crosses the ₹10L boundary.
 *       30% × ₹1L (₹11L→₹10L) + 20% × ₹1L (₹10L→₹9L) = ₹50k saved.
 *   • The ₹10k difference matters more for users near boundaries; users
 *     firmly inside a slab see the same answer either way.
 *
 * State tax (US): currently treated as flat at the user's effective state
 * marginal — the state slab structure is too varied to bracket-walk here.
 * Federal saving is exact; state saving uses `state × deduction` flat.
 */
export function deductionTaxSaving(args: {
  taxableIncome: Decimal | string | number;
  deductionAmount: Decimal | string | number;
  country: Country;
  taxRegime?: TaxRegimeIN;
  filingStatus?: FilingStatusUS;
  stateMarginalRate?: string;
  stateMarginalRateOverride?: string;
}): Decimal {
  const taxable = Decimal.max(D(args.taxableIncome), D(0));
  const deduction = Decimal.max(D(args.deductionAmount), D(0));
  if (deduction.lte(0) || taxable.lte(0)) return D(0);
  const reduced = Decimal.max(taxable.minus(deduction), D(0));
  if (args.country === 'IN') {
    const brackets = bracketsIN(args.taxRegime ?? 'new');
    const saving = totalTaxForBrackets(taxable, brackets).minus(
      totalTaxForBrackets(reduced, brackets),
    );
    return Decimal.max(saving, D(0));
  }
  const brackets = bracketsUS(args.filingStatus ?? 'single');
  const federalSaving = totalTaxForBrackets(taxable, brackets).minus(
    totalTaxForBrackets(reduced, brackets),
  );
  const stateOverride = D(args.stateMarginalRateOverride);
  const stateRate = stateOverride.gt(0)
    ? stateOverride
    : D(args.stateMarginalRate);
  // State saving applied flat — most US states are roughly flat or
  // gently progressive at deductible amounts, and we don't model the
  // 50+ state bracket structures client-side.
  const stateSaving = deduction.mul(stateRate);
  return Decimal.max(federalSaving.plus(stateSaving), D(0));
}
