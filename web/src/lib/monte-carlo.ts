/**
 * Monte Carlo simulation for variable-return investments.
 *
 * Generates N trials of annual returns drawn from a log-normal
 * distribution parameterized by mean (μ) and annual volatility (σ).
 * Compounds each trial over the holding period to produce a distribution
 * of terminal returns.
 *
 * Why log-normal: prices can't go negative, and historical equity
 * returns are reasonably modeled as log-normal over multi-year windows.
 * Pure normal-on-returns gives unrealistically symmetric tails.
 *
 * No dependency on a third-party RNG — uses a Box-Muller transform on
 * Math.random(). Deterministic seed support is intentionally omitted;
 * the tool reruns per parameter change which gives the user a feel for
 * sampling variance.
 */
import Decimal from 'decimal.js';
import { dec } from './safe-decimal';

const D = dec;

/** One sample from a standard normal distribution (mean 0, std 1). */
function boxMuller(): number {
  // Math.random can rarely return exactly 0 which would blow up log;
  // clamp away from 0 (and 1, for symmetry).
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export interface MonteCarloInput {
  /** Expected nominal annual return as decimal (0.10 = 10%). */
  expectedReturn: number;
  /** Annualised volatility (1σ) as decimal. 0 collapses to deterministic. */
  volatility: number;
  /** Holding period in years. */
  years: number;
  /** Number of trials. Default 5000 is fast in-browser. */
  trials?: number;
  /** Effective tax rate on gains (flat — caller pre-computes for LTCG
   *  vs slab). 0 = tax-free. */
  taxRate: number;
  /** Annual inflation rate. When > 0, the helper also returns the
   *  real-terms distribution (CPI-adjusted). */
  inflation?: number;
}

export interface MonteCarloResult {
  /** Trial-by-trial *annualized* nominal after-tax return as decimals. */
  trialReturns: number[];
  /** Same distribution adjusted for inflation (real terms). */
  trialRealReturns: number[];
  /** Percentiles over trialReturns (after-tax nominal). */
  percentilesNominal: Record<5 | 25 | 50 | 75 | 95, number>;
  /** Percentiles over trialRealReturns. */
  percentilesReal: Record<5 | 25 | 50 | 75 | 95, number>;
  /** P(return > loan_rate) across trials. Caller supplies loan rate
   *  separately so we can compute both nominal and real probabilities. */
  probBeatLoanNominal: (loanRate: number) => number;
  probBeatLoanReal: (loanRealRate: number) => number;
}

/**
 * Simulate Monte Carlo returns.
 *
 * For each trial:
 *   1. Draw `years` annual returns from log-normal(μ, σ).
 *   2. Compound them: terminal_factor = ∏ (1 + r_t).
 *   3. Convert terminal_factor to annualized return: (factor)^(1/years) − 1.
 *   4. Apply tax: r_after = r_pretax × (1 − tax_rate).
 *      (Simplification — real LTCG/STCG depends on holding period and
 *       individual lot timing. For a comparison-card tool, flat after-tax
 *       is the right scope.)
 *   5. Adjust for inflation if provided: r_real = (1 + r) / (1 + π) − 1.
 */
export function simulateMonteCarlo(input: MonteCarloInput): MonteCarloResult {
  const trials = input.trials ?? 5000;
  const years = Math.max(1, input.years);
  const mu = input.expectedReturn;
  const sigma = input.volatility;
  const taxRate = input.taxRate;
  const infl = input.inflation ?? 0;

  // Log-normal parameters: if we want E[1+R] = (1+mu) and Var(R) = sigma^2,
  // then the underlying normal has mean lnMean and std lnStd.
  // Approximation (small returns): lnMean ≈ mu − σ²/2, lnStd ≈ σ.
  const lnStd = sigma;
  const lnMean = Math.log(1 + mu) - 0.5 * sigma * sigma;

  const trialReturns: number[] = new Array(trials);
  const trialRealReturns: number[] = new Array(trials);

  for (let t = 0; t < trials; t += 1) {
    let logFactor = 0;
    for (let y = 0; y < years; y += 1) {
      // Sample annual log-return; convert to multiplier.
      const z = boxMuller();
      const logRet = lnMean + lnStd * z;
      logFactor += logRet;
    }
    const totalMultiplier = Math.exp(logFactor);
    const preTax = Math.pow(totalMultiplier, 1 / years) - 1;
    const afterTax = preTax * (1 - taxRate);
    trialReturns[t] = afterTax;
    trialRealReturns[t] =
      infl > 0 ? (1 + afterTax) / (1 + infl) - 1 : afterTax;
  }

  const sortedNominal = trialReturns.slice().sort((a, b) => a - b);
  const sortedReal = trialRealReturns.slice().sort((a, b) => a - b);

  function pct(sorted: number[], p: number): number {
    const idx = Math.floor((p / 100) * sorted.length);
    return sorted[Math.min(idx, sorted.length - 1)];
  }

  return {
    trialReturns,
    trialRealReturns,
    percentilesNominal: {
      5: pct(sortedNominal, 5),
      25: pct(sortedNominal, 25),
      50: pct(sortedNominal, 50),
      75: pct(sortedNominal, 75),
      95: pct(sortedNominal, 95),
    },
    percentilesReal: {
      5: pct(sortedReal, 5),
      25: pct(sortedReal, 25),
      50: pct(sortedReal, 50),
      75: pct(sortedReal, 75),
      95: pct(sortedReal, 95),
    },
    probBeatLoanNominal: (loanRate: number) =>
      trialReturns.filter((r) => r > loanRate).length / trials,
    probBeatLoanReal: (loanRealRate: number) =>
      trialRealReturns.filter((r) => r > loanRealRate).length / trials,
  };
}

/**
 * Convert nominal loan rate to real-terms loan rate at a given inflation.
 *   real = (1 + nominal) / (1 + inflation) − 1
 */
export function toRealRate(
  nominal: Decimal | string | number,
  inflation: Decimal | string | number,
): Decimal {
  const n = D(nominal);
  const i = D(inflation);
  return n.plus(1).div(i.plus(1)).minus(1);
}
