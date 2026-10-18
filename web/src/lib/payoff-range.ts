/**
 * Copy for the debt-free date as an exact month AND a range (grill #24,
 * sprint G4). The numbers come from POST /api/sensitivity/range
 * (engine/sensitivity.debt_free_range): the plan as entered, then floating
 * rates ±1 point and ±1 month of take-home pay. This file only turns that
 * into words, so the UI shows the same reasons the engine used.
 */

import { formatMonth } from './today';

export interface RangeScenario {
  id: 'rate_down' | 'rate_up' | 'income_gap' | 'income_bonus' | string;
  label: string;
  why: string;
  debt_free_month: number | null;
  shift_months: number | null;
}

export interface PayoffRange {
  exact: number | null;
  earliest: number | null;
  latest: number | null;
  scenarios: RangeScenario[];
  has_floating: boolean;
  open_ended: boolean;
}

/** Month index (1 = the plan's first month) → "Mar 2031" (the short date). */
export function monthLabel(index: number, start: Date): string {
  const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + index - 1, 1));
  return formatMonth(d.getUTCFullYear(), d.getUTCMonth(), 'short');
}

/** "Mar 2031" exact, "Jan–Apr 2031" or "Dec 2030 – Apr 2031" range. */
export function rangeLabel(r: PayoffRange, start: Date): { exact: string; range: string | null } {
  if (r.exact == null) return { exact: 'not inside the plan', range: null };
  const exact = monthLabel(r.exact, start);
  if (r.earliest == null) return { exact, range: null };
  const lo = monthLabel(r.earliest, start);
  if (r.latest == null) return { exact, range: `${lo} or later` };
  if (r.latest === r.earliest) return { exact, range: null };
  const hi = monthLabel(r.latest, start);
  const [lm, ly] = lo.split(' ');
  const [hm, hy] = hi.split(' ');
  return { exact, range: ly === hy ? `${lm}–${hm} ${hy}` : `${lo} – ${hi}` };
}

function shiftWords(s: number | null): string {
  if (s == null) return 'not paid off inside the plan';
  if (s === 0) return 'no change';
  const n = Math.abs(s);
  return `${n} month${n === 1 ? '' : 's'} ${s < 0 ? 'sooner' : 'later'}`;
}

/** The "Why this range" lines, one per scenario: "Floating rates 1 point
 *  higher: 3 months later. <why>". */
export function whyThisRange(r: PayoffRange): string[] {
  const lines = r.scenarios.map((s) => `${s.label}: ${shiftWords(s.shift_months)}. ${s.why}`);
  lines.push(
    'The exact month is your plan as entered: today\'s rates and today\'s pay. '
    + 'The range is the same plan with the few things that most often move a payoff date. It isn\'t a forecast.',
  );
  return lines;
}

/** Plain-words explainers for the terms beside the range (copy rule: every
 *  technical term gets an explanation). */
export const RANGE_TERMS = {
  rate_drift: 'Rate drift: the yearly change you expect in a floating loan\'s rate, applied at each reset date and never more than 3 points from where it started. You set it; it isn\'t a forecast.',
  sensitivity: 'What-if (sensitivity): the plan run again with one thing changed, so you can see which risk matters for you.',
  monte_carlo: 'Monte Carlo: thousands of random runs of something uncertain. RightDue uses it for investment returns only (Invest or prepay), not for the payoff date, because loan rates move in steps, not at random.',
} as const;

/**
 * Reference cost of sending money US → India (grill #35): the World Bank's
 * average fee + exchange-rate margin on a $200 transfer, Q3 2025. Larger
 * transfers through digital providers usually cost less. A hint beside the
 * NRI remittance-cost field (G10), never a silent default. Registered in
 * engine/data_freshness.json.
 */
export const REMITTANCE_REFERENCE = {
  rate: '0.0368',
  label: 'World Bank average for US → India: 3.7% of a $200 transfer (Q3 2025). Larger transfers usually cost less.',
  url: 'https://remittanceprices.worldbank.org/corridor/United-States/India',
  asOf: '2026-10-12',
} as const;
