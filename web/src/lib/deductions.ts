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
import type { AgeBracket, Country, DeductionsPayload, FilingStatusUS, TaxRegimeIN } from './api';

const D = (v: string | number | Decimal | null | undefined) =>
  new Decimal(v ?? '0');

// India statutory caps (FY25/AY26)
const CAP_80C = D('150000');
const CAP_80D_DEFAULT = D('25000');
const CAP_80D_SENIOR = D('50000');
const CAP_80CCD_1B = D('50000');

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
    if (taxRegime !== 'old') {
      return { lines: [], totalAllowed: D(0), totalClaimed: D(0) };
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

// ─── Bracket lookups ────────────────────────────────────────────────────────
// These mirror engine/country_data.py bracket structures at a coarse level.
// We don't need surgical accuracy — these power the Setup "derived marginal"
// preview, not the actual tax sleeve math.

function marginalIN(taxable: Decimal, regime: TaxRegimeIN): Decimal {
  const t = taxable.toNumber();
  if (regime === 'new') {
    // FY24-25 new regime brackets (approximation):
    // 0-3L: 0%, 3-7L: 5%, 7-10L: 10%, 10-12L: 15%, 12-15L: 20%, 15L+: 30%
    if (t <= 300000) return D(0);
    if (t <= 700000) return D('0.05');
    if (t <= 1000000) return D('0.10');
    if (t <= 1200000) return D('0.15');
    if (t <= 1500000) return D('0.20');
    return D('0.30');
  }
  // Old regime brackets:
  // 0-2.5L: 0%, 2.5-5L: 5%, 5-10L: 20%, 10L+: 30%
  if (t <= 250000) return D(0);
  if (t <= 500000) return D('0.05');
  if (t <= 1000000) return D('0.20');
  return D('0.30');
}

function marginalUS(taxable: Decimal, filing: FilingStatusUS): Decimal {
  const t = taxable.toNumber();
  // 2026 federal brackets (approximation):
  if (filing === 'mfj') {
    if (t <= 23200) return D('0.10');
    if (t <= 94300) return D('0.12');
    if (t <= 201050) return D('0.22');
    if (t <= 383900) return D('0.24');
    if (t <= 487450) return D('0.32');
    if (t <= 731200) return D('0.35');
    return D('0.37');
  }
  // Single / HOH simplified to single brackets:
  if (t <= 11600) return D('0.10');
  if (t <= 47150) return D('0.12');
  if (t <= 100525) return D('0.22');
  if (t <= 191950) return D('0.24');
  if (t <= 243725) return D('0.32');
  if (t <= 609350) return D('0.35');
  return D('0.37');
}
