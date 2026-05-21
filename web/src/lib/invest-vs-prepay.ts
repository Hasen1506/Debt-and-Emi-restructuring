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
}

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

/**
 * Default safe-vehicle quotes as of 2026-05.
 *
 * These are reasonable retail-investor benchmarks. They should be
 * editable per-user in a later phase (e.g. "your bank's actual FD rate"),
 * but for the v1 card these defaults match what an average user would
 * see if they shopped around for 10 minutes.
 */
export function safeBenchmarks(
  country: Country,
  marginalRate: string | Decimal,
): SafeVehicle[] {
  const marginal = D(marginalRate || '0');

  if (country === 'IN') {
    // 1-yr SBI / HDFC FD ~7.1%, quarterly compounding, taxed at slab.
    const fdNominal = D('0.071');
    const fdEffective = quarterlyCompound(fdNominal);
    const fdAfterTax = fdEffective.mul(D('1').minus(marginal));

    // Tax-free bonds (NHAI / REC / IRFC / PFC secondary market) ~5.25%,
    // semi-annual coupon, but the coupon is tax-free so we treat it
    // straight — no compounding adjustment, no tax.
    const tfbNominal = D('0.0525');

    // 1-yr T-Bill / GSec ~7.0%, taxed at slab. Half-yearly coupon
    // approximation — close enough for a comparison card.
    const gsecNominal = D('0.07');
    const gsecAfterTax = gsecNominal.mul(D('1').minus(marginal));

    return [
      {
        key: 'fd_in',
        name: 'Bank FD',
        nominalRate: fdNominal,
        preTaxEffective: fdEffective,
        afterTaxEffective: fdAfterTax,
        note:
          'Quarterly compounding · taxed at your slab',
        risk: 'safe',
      },
      {
        key: 'tax_free_bond_in',
        name: 'Tax-free bonds (NHAI/REC)',
        nominalRate: tfbNominal,
        preTaxEffective: tfbNominal,
        afterTaxEffective: tfbNominal,
        note:
          'Coupon is tax-free · only sensible in 30%+ slabs',
        risk: 'safe',
      },
      {
        key: 'gsec_in',
        name: 'GoI dated security (G-Sec)',
        nominalRate: gsecNominal,
        preTaxEffective: gsecNominal,
        afterTaxEffective: gsecAfterTax,
        note: 'Govt-backed · taxed at slab · low liquidity',
        risk: 'safe',
      },
    ];
  }

  // US
  // HYSA APY ~4.5% — already effective annual, taxed federal+state.
  // We use the user's marginal as a stand-in for fed+state combined;
  // it's the same field for both countries.
  const hysaAPY = D('0.045');
  const hysaAfterTax = hysaAPY.mul(D('1').minus(marginal));

  // 1-yr Treasury ~5.0%, state-tax exempt. We can't distinguish fed
  // from state in `marginal`, so approximate: assume ~30% of marginal
  // is state for high-tax-state users. A conservative "state-exempt
  // shield" of marginal × 0.2 is the closest single-knob approximation.
  const treasNominal = D('0.05');
  const stateExemptShield = marginal.mul(D('0.2'));
  const treasEffectiveTax = marginal.minus(stateExemptShield);
  const treasAfterTax = treasNominal.mul(D('1').minus(treasEffectiveTax));

  return [
    {
      key: 'hysa_us',
      name: 'HYSA (Marcus, Ally, etc.)',
      nominalRate: hysaAPY,
      preTaxEffective: hysaAPY,
      afterTaxEffective: hysaAfterTax,
      note:
        'APY-quoted (already compounded) · taxed federal + state',
      risk: 'safe',
    },
    {
      key: 'treasury_us',
      name: '1-yr US Treasury',
      nominalRate: treasNominal,
      preTaxEffective: treasNominal,
      afterTaxEffective: treasAfterTax,
      note: 'Federal tax only · state-exempt',
      risk: 'safe',
    },
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
      explanation: `Prepaying saves ${spreadAbs.mul(100).toFixed(2)}%/yr more than parking it in ${best.name} after tax. The loan rate is certain; the FD/bond yield is not (rates can fall).`,
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
