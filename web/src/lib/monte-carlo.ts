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
 * Math.random(). An optional `seed` (sprint G4, grill #41) makes a run
 * reproducible for golden tests; without one the tool reruns per parameter
 * change, which gives the user a feel for sampling variance.
 */
/** A small seeded generator (mulberry32) so a run can be reproduced in a
 *  golden test (grill #41). Without a seed the tool keeps Math.random. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One sample from a standard normal distribution (mean 0, std 1). */
function boxMuller(rand: () => number = Math.random): number {
  // The generator can rarely return exactly 0 which would blow up log;
  // clamp away from 0 (and 1, for symmetry).
  let u = 0;
  let v = 0;
  while (u === 0) u = rand();
  while (v === 0) v = rand();
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
  /** Optional seed: the same seed gives the same trials (golden tests).
   *  Omitted in the tool, which reruns per change on Math.random. */
  seed?: number;
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
 *   1. Draw the aggregate log return for the exact holding period.
 *   2. Scale drift by years and uncertainty by sqrt(years).
 *   3. Convert terminal_factor to annualized return: (factor)^(1/years) − 1.
 *   4. Apply tax to positive gains: r_after = r_pretax × (1 − tax_rate).
 *      (Simplification — real LTCG/STCG depends on holding period and
 *       individual lot timing. For a comparison-card tool, flat after-tax
 *       is the right scope.)
 *   5. Adjust for inflation if provided: r_real = (1 + r) / (1 + π) − 1.
 */
export function simulateMonteCarlo(input: MonteCarloInput): MonteCarloResult {
  const trials = input.trials ?? 5000;
  const years = input.years;
  if (![years, input.expectedReturn, input.volatility, input.taxRate, input.inflation ?? 0].every(Number.isFinite)
      || years <= 0 || years > 100 || input.expectedReturn <= -1 || input.expectedReturn > 10
      || input.volatility < 0 || input.volatility > 5 || input.taxRate < 0 || input.taxRate > 1
      || (input.inflation ?? 0) <= -1 || !Number.isInteger(trials) || trials < 1 || trials > 100_000) {
    throw new Error('Invalid simulation inputs. Use a positive holding period up to 100 years and finite rates.');
  }
  const mu = input.expectedReturn;
  const sigma = input.volatility;
  const taxRate = input.taxRate;
  const infl = input.inflation ?? 0;
  const rand = input.seed === undefined ? Math.random : seededRandom(input.seed);

  // Log-normal parameters: if we want E[1+R] = (1+mu) and Var(R) = sigma^2,
  // then the underlying normal has mean lnMean and std lnStd.
  // Approximation (small returns): lnMean ≈ mu − σ²/2, lnStd ≈ σ.
  const lnStd = sigma;
  const lnMean = Math.log(1 + mu) - 0.5 * sigma * sigma;

  const trialReturns: number[] = new Array(trials);
  const trialRealReturns: number[] = new Array(trials);

  for (let t = 0; t < trials; t += 1) {
    // The sum of independent log returns is normal. Scale drift by the
    // exact holding period and uncertainty by sqrt(time), including stub years.
    const logFactor = lnMean * years + lnStd * Math.sqrt(years) * (sigma === 0 ? 0 : boxMuller(rand));
    const preTax = Math.exp(logFactor / years) - 1;
    const afterTax = preTax > 0 ? preTax * (1 - taxRate) : preTax;
    trialReturns[t] = afterTax;
    trialRealReturns[t] =
      (1 + afterTax) / (1 + infl) - 1;
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
