/**
 * Simple invest-vs-prepay comparison for /plan.
 *
 * Compares the top-priority loan's effective APR against a small set of
 * country-appropriate safe vehicles, with proper after-tax treatment and
 * the right compounding convention. Pure functions — UI consumes them
 * via [[InvestVsPrepayCard]].
 *
 * Scope:
 *   • Fixed-return vehicles only (FD, tax-free bonds, HYSA, Treasury).
 *   • Equity / variable-return is intentionally out of scope here — those
 *     need probability modeling and live in `/tools/invest-vs-prepay`.
 *   • Quarterly compounding for IN FDs (matches bank convention).
 *   • Monthly compounding for US HYSA (APY convention; the input rate is
 *     already the effective annual).
 *   • Slab-tax applied to vehicles whose interest is taxed at slab —
 *     FDs, HYSAs. Tax-free bonds and Treasuries get partial / no tax.
 *
 * The same yields and tax rules feed the deep-dive tool, so the two can't
 * disagree. Each default yield carries the date it was true on.
 */
import Decimal from 'decimal.js';
import type { Country } from './api';

const D = (v: string | number | Decimal) => new Decimal(v);

export type RiskLevel = 'safe' | 'moderate' | 'high';

export interface SafeVehicle {
  /** Key used for React keys / analytics. */
  key: string;
  /** User-facing name. */
  name: string;
  /** Quoted (nominal) rate as a decimal — e.g. 0.071 for 7.1%. */
  nominalRate: Decimal;
  /** Effective annual rate after compounding but before tax. */
  preTaxEffective: Decimal;
  /** Effective annual rate after tax and compounding — apples-to-apples
   *  vs the loan's effective APR. */
  afterTaxEffective: Decimal;
  /** One-line plain-English note: compounding + tax treatment. */
  note: string;
  /** Risk tier. "safe" = govt-backed or insured. "moderate" = AAA
   *  corporate. "high" = equity / variable. */
  risk: RiskLevel;
  /** When the default yield was true, and where it comes from. */
  asOf: string;
  source: string;
}

/**
 * How an instrument's return is taxed.
 *   • income — at the user's marginal rate, times `share` (a US Treasury
 *     is 0.8: state tax doesn't apply, and the one marginal-rate field
 *     holds federal + state, of which state is taken as ~20%);
 *   • flat — at a fixed rate whatever the user's slab (capital gains);
 *   • none — tax-free.
 */
export type ReturnTax =
  | { kind: 'income'; share: number }
  | { kind: 'flat'; rate: number }
  | { kind: 'none' };

/** The tax rate a return pays under `tax` for a user at `marginal`. */
export function returnTaxRate(tax: ReturnTax, marginal: Decimal | string | number): Decimal {
  if (tax.kind === 'none') return D(0);
  if (tax.kind === 'flat') return D(tax.rate);
  return Decimal.max(D(0), D(marginal || 0)).mul(tax.share);
}

/** A pre-tax annual return after tax. Losses pay no tax. */
export function afterTaxReturn(
  preTax: Decimal,
  tax: ReturnTax,
  marginal: Decimal | string | number,
): Decimal {
  if (preTax.lte(0)) return preTax;
  return preTax.mul(D(1).minus(returnTaxRate(tax, marginal)));
}

export interface SafeRate {
  /** Quoted annual yield, decimal. */
  rate: string;
  tax: ReturnTax;
  compounding: 'simple' | 'quarterly';
  /** The day (or month) the yield was true on, ISO. */
  asOf: string;
  source: string;
}

/**
 * Default yields for the safe vehicles, dated, each from a published quote:
 *   • FD: SBI 6.25% for 1 year (from 15 Dec 2025) and HDFC Bank 6.25% for
 *     1 year to 15 months (from 6 Mar 2026), still current in Sep 2026.
 *   • T-bill: RBI's 364-day auction of 9 Sep 2026 cut off at 5.909%.
 *   • Liquid fund: yield to maturity about 6.5% in early Sep 2026.
 *   • HYSA: top online savings accounts about 4.25% APY, late Sep 2026.
 *   • Treasury: the 1-year Treasury yield closed at 4.54% on 30 Sep 2026.
 *   • Tax-free bonds: typical secondary-market yield, May 2026.
 * Both screens say so and ask for today's yield when the answer is close.
 */
export const SAFE_RATES = {
  fd_in: {
    rate: '0.0625', tax: { kind: 'income', share: 1 }, compounding: 'quarterly',
    asOf: '2026-09', source: '1-yr FD rate at SBI and HDFC Bank',
  },
  tax_free_bond_in: {
    rate: '0.0525', tax: { kind: 'none' }, compounding: 'simple',
    asOf: '2026-05', source: 'typical NHAI / REC secondary-market yield',
  },
  gsec_in: {
    rate: '0.0591', tax: { kind: 'income', share: 1 }, compounding: 'simple',
    asOf: '2026-09-09', source: 'yield at RBI’s 364-day T-bill auction',
  },
  liquid_in: {
    rate: '0.065', tax: { kind: 'income', share: 1 }, compounding: 'simple',
    asOf: '2026-09', source: 'yield to maturity of a liquid fund',
  },
  hysa_us: {
    rate: '0.0425', tax: { kind: 'income', share: 1 }, compounding: 'simple',
    asOf: '2026-09', source: 'APY at a top online savings account',
  },
  treasury_us: {
    rate: '0.0454', tax: { kind: 'income', share: 0.8 }, compounding: 'simple',
    asOf: '2026-09-30', source: 'US Treasury 1-yr yield',
  },
} satisfies Record<string, SafeRate>;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "25 Sep 2026" for a day, "May 2026" for a month. */
export function formatAsOf(asOf: string): string {
  const [y, m, d] = asOf.split('-');
  const month = MONTHS[Number(m) - 1] ?? m;
  return d ? `${Number(d)} ${month} ${y}` : `${month} ${y}`;
}

/** Pre-tax effective annual yield of a safe rate. */
function preTaxOf(r: SafeRate): Decimal {
  return r.compounding === 'quarterly' ? quarterlyCompound(r.rate) : D(r.rate);
}

/** A comparison within this many points of the loan rate turns on the
 *  exact yield, so the screens ask for today's instead of trusting a
 *  dated default. */
export const CLOSE_CALL = D('0.01');

/**
 * Quarterly compounding: effective = (1 + r/4)^4 − 1
 *
 * Convention for India FDs — interest is credited quarterly and added
 * back to principal. A 7.1% nominal FD actually returns ~7.29% effective.
 */
export function quarterlyCompound(nominal: Decimal | string): Decimal {
  const r = D(nominal);
  return r.div(4).plus(1).pow(4).minus(1);
}

/**
 * Monthly compounding: effective = (1 + r/12)^12 − 1
 *
 * Most US HYSAs quote APY (already-compounded). We still expose the
 * helper for cases where a nominal-APR is given.
 */
export function monthlyCompound(nominal: Decimal | string): Decimal {
  const r = D(nominal);
  return r.div(12).plus(1).pow(12).minus(1);
}

/** The safe vehicles for a country, with after-tax yields at `marginalRate`. */
export function safeBenchmarks(
  country: Country,
  marginalRate: string | Decimal,
): SafeVehicle[] {
  const marginal = D(marginalRate || '0');
  const vehicle = (
    key: keyof typeof SAFE_RATES,
    name: string,
    note: string,
  ): SafeVehicle => {
    const r: SafeRate = SAFE_RATES[key];
    const pre = preTaxOf(r);
    return {
      key,
      name,
      nominalRate: D(r.rate),
      preTaxEffective: pre,
      afterTaxEffective: afterTaxReturn(pre, r.tax, marginal),
      note,
      risk: 'safe',
      asOf: r.asOf,
      source: r.source,
    };
  };

  if (country === 'IN') {
    return [
      vehicle('fd_in', 'Bank FD', 'Quarterly compounding · taxed at your slab'),
      vehicle('tax_free_bond_in', 'Tax-free bonds (NHAI/REC)',
        'Coupon is tax-free · only sensible in 30%+ slabs'),
      vehicle('gsec_in', 'GoI dated security (G-Sec)',
        'Govt-backed · taxed at slab · low liquidity'),
    ];
  }
  return [
    // The user's marginal rate stands in for federal + state combined.
    vehicle('hysa_us', 'HYSA (Marcus, Ally, etc.)',
      'APY-quoted (already compounded) · taxed federal + state'),
    vehicle('treasury_us', '1-yr US Treasury',
      'Federal tax only · state-exempt (taxed at ~80% of your rate)'),
  ];
}

export type Verdict = 'prepay' | 'invest_safe' | 'too_close';

export interface ComparisonResult {
  /** What we recommend. */
  verdict: Verdict;
  /** The vehicle that scored best on after-tax basis. */
  bestVehicle: SafeVehicle;
  /** The spread (loan effective − vehicle after-tax). Positive means
   *  prepaying wins. */
  spreadPct: Decimal;
  /** Human-readable explanation, suitable for the card body. */
  explanation: string;
}

/**
 * Compare a loan's effective rate against the best safe vehicle.
 *
 * The threshold for "too close" is 50 bps — within half a percentage
 * point, the comparison is dominated by friction (account opening,
 * liquidity, behavioral drift) rather than the math.
 */
export function compareToLoan(
  loanEffectiveRate: Decimal | string,
  vehicles: SafeVehicle[],
): ComparisonResult {
  const loanRate = D(loanEffectiveRate);
  const best = vehicles.reduce((a, b) =>
    b.afterTaxEffective.gt(a.afterTaxEffective) ? b : a,
  );

  const spread = loanRate.minus(best.afterTaxEffective);
  const spreadAbs = spread.abs();
  const closeThreshold = D('0.005'); // 50 bps

  if (spreadAbs.lt(closeThreshold)) {
    return {
      verdict: 'too_close',
      bestVehicle: best,
      spreadPct: spread,
      explanation: `Within 50 bps — too close to matter. Prepay if you value certainty; invest if you want liquidity.`,
    };
  }

  if (spread.gt(0)) {
    return {
      verdict: 'prepay',
      bestVehicle: best,
      spreadPct: spread,
      explanation: `Prepaying saves ${spreadAbs.mul(100).toFixed(2)}%/yr more than parking it in ${best.name} after tax. The loan rate is certain; the savings yield is not (rates can fall).`,
    };
  }

  return {
    verdict: 'invest_safe',
    bestVehicle: best,
    spreadPct: spread,
    explanation: `${best.name} after-tax beats your loan by ${spreadAbs.mul(100).toFixed(2)}%/yr. Worth parking the surplus there instead of prepaying — but only because your loan rate is unusually low.`,
  };
}

/** Format a Decimal as a percentage string. */
export function pct(d: Decimal | string | number, digits = 2): string {
  return `${D(d).mul(100).toFixed(digits)}%`;
}
