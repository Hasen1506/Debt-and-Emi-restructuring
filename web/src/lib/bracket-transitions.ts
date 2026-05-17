/**
 * Bracket-transition projector — when does the user cross into a new tax
 * bracket as their hikes accumulate?
 *
 * Inputs:
 *   • country + tax_regime + income_type — drive which slab table applies
 *   • annual_gross_salary OR annual_business_income — starting point
 *   • annual_hike_rate + hike_schedule — year-by-year growth
 *
 * For each year of the projection, applies the resolved hike rate to last
 * year's gross, re-classifies bracket, and emits a transition event when
 * the marginal rate changes. Returned events are 1-based year-indexed so
 * they line up with the engine's hike firing months.
 *
 * Returns empty when:
 *   • no gross income provided (can't classify);
 *   • marginal rate never moves over the horizon (e.g. user starts at top
 *     slab, or no hikes at all).
 */
import type { Country, FilingStatusUS, IncomeType, TaxRegimeIN } from './api';
import { classifyBracket, type BracketInfo } from './tax-brackets';

export interface BracketTransition {
  /** Year of the projection (1-based) the transition fires in. */
  year: number;
  /** Previous bracket the user was in. */
  from: BracketInfo;
  /** New bracket they enter. */
  to: BracketInfo;
  /** Annual income at the transition year (after the year's hike). */
  incomeAtTransition: number;
}

/**
 * Resolve the hike rate for a 1-based year from the same {from, to, rate}
 * triples the engine uses. Falls back to scalar `annualHikeRate` for
 * year ranges not covered by any phase.
 */
function resolveHikeRate(
  year: number,
  phases: [number, number, string][] | undefined,
  fallbackRate: number,
): number {
  for (const [from, to, rate] of phases ?? []) {
    if (year >= from && year < to) {
      const r = Number(rate);
      return Number.isFinite(r) ? r : fallbackRate;
    }
  }
  return fallbackRate;
}

export function projectBracketTransitions(args: {
  country: Country;
  taxRegime?: TaxRegimeIN;
  incomeType: IncomeType;
  grossIncome: number;
  annualHikeRate: number;
  hikeSchedule?: [number, number, string][];
  horizonYears?: number;
  filingStatus?: FilingStatusUS;
}): BracketTransition[] {
  const {
    country,
    taxRegime,
    incomeType,
    grossIncome,
    annualHikeRate,
    hikeSchedule,
    horizonYears = 20,
    filingStatus,
  } = args;

  if (!Number.isFinite(grossIncome) || grossIncome <= 0) return [];
  const initial = classifyBracket(country, taxRegime, incomeType, grossIncome, filingStatus);
  if (!initial) return [];

  const out: BracketTransition[] = [];
  let income = grossIncome;
  let prev = initial;

  for (let year = 1; year <= horizonYears; year++) {
    const rate = resolveHikeRate(year, hikeSchedule, annualHikeRate);
    if (rate <= 0) continue;          // no growth this year, bracket can't move
    income = income * (1 + rate);
    const current = classifyBracket(country, taxRegime, incomeType, income, filingStatus);
    if (!current) continue;
    if (current.marginalRate > prev.marginalRate) {
      out.push({
        year,
        from: prev,
        to: current,
        incomeAtTransition: income,
      });
    }
    prev = current;
  }
  return out;
}
