/**
 * What a short month does to the plan, in one place (sprint L2).
 *
 *  - Grill #38: the engine now pays a short month from the emergency fund,
 *    then borrows the rest at a card's rate and repays it first
 *    (engine/gap_debt.py). This turns the API's per-month gap fields into
 *    what the Plan page shows.
 *  - Live test #16: one story for the date. The headline gives the date if
 *    the gap closes, beside the date as things stand, and says which is which.
 *  - Live test #17: the chart's x-axis ends at the plan's own payoff month.
 *  - Live test #24: "due" beside what the month can actually cover.
 *
 * Pure functions only, so web/tests can check them without a browser.
 */
import type { SimulateResponse, TrajectoryPointRaw } from './api';

export interface GapMonth {
  /** Gap borrowing owed at the month's end (user's currency). */
  debt: number;
  borrowed: number;
  repaid: number;
  interest: number;
  fromSavings: number;
}

export interface PlanGap {
  /** Yearly rate the gap is borrowed at (before GST), e.g. 0.45. */
  rate: number;
  /** 'your_card': the dearest card on the profile; 'default': the country figure. */
  basis: 'your_card' | 'default';
  source: string | null;
  /** Interest on gap borrowing over the plan (already in total interest). */
  totalInterest: number;
  /** Most owed at any month end, and when. */
  peak: number;
  peakMonth: number | null;
  /** First month anything was borrowed; month it was all repaid (null: never). */
  firstBorrowMonth: number | null;
  repaidMonth: number | null;
  /** Covered by the emergency fund over the plan. */
  fromSavings: number;
  /** The plan with this month's gap closed (spending cut by it). */
  closed: { cut: number; debtFreeMonth: number | null; totalInterest: number } | null;
  months: Record<number, GapMonth>;
}

const n = (v: string | number | null | undefined) => (v == null ? 0 : Number(v) || 0);

/** The gap-borrowing story from a /simulate response; null when the plan
 *  never borrowed and this month isn't short. */
export function planGap(sim: Pick<SimulateResponse, 'trajectory'> & Partial<SimulateResponse>): PlanGap | null {
  const months: Record<number, GapMonth> = {};
  let peak = 0;
  let peakMonth: number | null = null;
  let firstBorrowMonth: number | null = null;
  let repaidMonth: number | null = null;
  let fromSavings = 0;
  for (const p of sim.trajectory as TrajectoryPointRaw[]) {
    const m: GapMonth = {
      debt: n(p.gap_debt),
      borrowed: n(p.gap_borrowed),
      repaid: n(p.gap_repaid),
      interest: n(p.gap_interest),
      fromSavings: n(p.gap_from_savings),
    };
    if (m.debt || m.borrowed || m.repaid || m.interest || m.fromSavings) months[p.month] = m;
    fromSavings += m.fromSavings;
    if (m.borrowed > 0 && firstBorrowMonth === null) firstBorrowMonth = p.month;
    if (m.debt > peak) {
      peak = m.debt;
      peakMonth = p.month;
    }
    if (firstBorrowMonth !== null && m.debt <= 0.005 && m.repaid > 0) repaidMonth = p.month;
    if (m.debt > 0.005) repaidMonth = null;
  }
  const closed = sim.gap_closed
    ? {
        cut: n(sim.gap_closed.cut),
        debtFreeMonth: sim.gap_closed.debt_free_month ?? null,
        totalInterest: n(sim.gap_closed.total_interest_paid),
      }
    : null;
  if (firstBorrowMonth === null && fromSavings <= 0 && !closed) return null;
  return {
    rate: n(sim.gap_rate),
    basis: sim.gap_rate_basis === 'your_card' ? 'your_card' : 'default',
    source: sim.gap_rate_source ?? null,
    totalInterest: n(sim.total_gap_interest),
    peak,
    peakMonth,
    firstBorrowMonth,
    repaidMonth,
    fromSavings,
    closed,
    months,
  };
}

/** "45%" / "22.36%": the gap rate in plain words. */
export function gapRateWords(rate: number): string {
  const pct = rate * 100;
  return `${Number.isInteger(Math.round(pct * 100) / 100) ? pct.toFixed(0) : pct.toFixed(2)}%`;
}

/**
 * Live test #16: the debt-free headline when the plan is short.
 * `asIs` is the engine's own date with the gap borrowed (what the schedule
 * below shows); `ifClosed` is the date with the gap closed. Both are named,
 * so the headline and the table tell one story.
 */
export function shortHeadline(args: {
  shortfall: number;
  asIsMonth: number | null;
  closedMonth: number | null | undefined;
  label: (m: number) => string;
  money: (v: number) => string;
}): { value: string; sub: string } {
  const { shortfall, asIsMonth, closedMonth, label, money } = args;
  const asIs = asIsMonth ? label(asIsMonth) : 'NOT IN 30 YEARS';
  if (shortfall > 0 && closedMonth) {
    return {
      value: label(closedMonth),
      sub: `IF THE ${money(shortfall)}/MO GAP CLOSES · AS THINGS STAND: ${asIs}`,
    };
  }
  if (shortfall > 0) {
    // Live re-test L#16: the gap-closed run has no date either (later
    // months fall short again), so say so instead of half a template.
    return {
      value: 'NO DATE YET',
      sub: `SHORT ${money(shortfall)}/MO · AS THINGS STAND: ${asIs}${asIsMonth ? '' : ' · NO DATE EVEN IF THIS MONTH’S GAP CLOSES'}`,
    };
  }
  // Only a later month is short: the engine's date already borrows for it.
  return { value: asIsMonth ? label(asIsMonth) : 'NO DATE YET', sub: 'A LATER MONTH IS SHORT · GAP BORROWED' };
}

/**
 * Live test #17: the month the chart's x-axis ends on. It follows the
 * plan's own payoff month (with the gap borrowed, when short), not a fixed
 * scale or the minimums-only line's end. `minClear` lets the dashed
 * minimums line show whole when it finishes within twice the plan.
 */
export function chartEndMonth(args: {
  planClears: number | null;
  minClear: number | null;
  lastMonth: number;
  /** First month gap borrowing starts, when the plan never repays it: the
   *  balance only grows, so three years of it show the trend without
   *  squashing everything else flat. */
  growingGapFrom?: number | null;
}): number {
  const { planClears, minClear, lastMonth, growingGapFrom } = args;
  if (!planClears && growingGapFrom) return Math.min(lastMonth, Math.max(24, growingGapFrom + 36));
  if (!planClears) return lastMonth;
  // Live re-test L#17: end at the payoff month itself. Padding to the end of
  // the minimums line (or a quarter more) ran the axis a year past payoff;
  // the minimums' own clear date is printed in the chart note instead.
  void minClear;
  return Math.min(lastMonth, planClears);
}

/**
 * Live test #24: in a short month, what's due against what the month can
 * cover. `minimums` is every EMI and card minimum this month; `room` is
 * income less costs (never below 0). `shortfall` is the engine's.
 */
export function dueVsAffordable(args: { income: number; costs: number; shortfall: number }): {
  due: number;
  canCover: number;
  short: number;
} {
  const canCover = Math.max(0, args.income - args.costs);
  const due = Math.max(0, args.shortfall + args.income - args.costs);
  return { due, canCover: Math.min(canCover, due), short: Math.max(0, due - canCover) };
}

/** One line for Home and Plan: what's due, what the month covers, what's short. */
export function dueVsAffordableLine(
  v: { due: number; canCover: number; short: number },
  money: (x: number) => string,
): string {
  return `Due this month: ${money(v.due)} in EMIs and minimums. After your costs you have ${money(v.canCover)} for them, so you're ${money(v.short)} short.`;
}

/** Schedule events from gap borrowing (live test #15): when it starts, when it's repaid. */
export function gapEvents(gap: PlanGap | null, money: (v: number) => string, rate: string): Map<number, string> {
  const out = new Map<number, string>();
  if (!gap) return out;
  if (gap.firstBorrowMonth) {
    const m = gap.months[gap.firstBorrowMonth];
    out.set(gap.firstBorrowMonth, `◐ SHORT · ${money(m?.borrowed ?? 0)} BORROWED ON A CARD AT ${rate}`);
  }
  if (gap.repaidMonth) out.set(gap.repaidMonth, '✓ GAP BORROWING REPAID');
  return out;
}

/** Live re-test 2 NEW-2: no ₹ figure on the Plan above this many times
 *  what's owed today; above it the debt "keeps growing". */
export const SANE_MULTIPLE = 100;
/** A plan that never clears shows at most this many months (30 years). */
export const NEVER_CLEARS_HORIZON = 360;

export function saneCap(owedToday: number): number {
  return SANE_MULTIPLE * Math.max(owedToday, 1);
}

/** A money cell: the figure, or "KEEPS GROWING" above the sanity cap. */
export function boundedMoney(v: number, cap: number, money: (v: number) => string): string {
  return Number.isFinite(v) && v <= cap ? money(v) : 'KEEPS GROWING';
}

/**
 * Live re-test 2 NEW-2: where the month-by-month schedule stops. A plan that
 * clears is shown whole. One that never clears stops at the API's cut month
 * (30 years), and never past the last month before loans + gap borrowing
 * pass 100x what's owed today (a backstop for an older API, too).
 */
export function scheduleStop(args: {
  rows: { mo: number; balance: number; gapDebt: number }[];
  owedToday: number;
  cut: { month: number | null; growsWithoutLimit: boolean } | null | undefined;
}): { lastMonth: number | null; growsWithoutLimit: boolean } {
  const { rows, owedToday, cut } = args;
  const cap = saneCap(owedToday);
  const limit = cut ? (cut.month ?? NEVER_CLEARS_HORIZON) : Infinity;
  let prev: number | null = null;
  for (const r of rows) {
    if (r.balance + r.gapDebt > cap) return { lastMonth: prev ?? 0, growsWithoutLimit: true };
    if (r.mo > limit) return { lastMonth: Math.min(limit, prev ?? limit), growsWithoutLimit: !!cut?.growsWithoutLimit };
    prev = r.mo;
  }
  if (cut) return { lastMonth: prev, growsWithoutLimit: cut.growsWithoutLimit };
  return { lastMonth: null, growsWithoutLimit: false };
}

/** The line under a schedule that stops (NEW-2). */
export function scheduleStopLine(growsWithoutLimit: boolean, stopLabel: string): string {
  return growsWithoutLimit
    ? `GAP BORROWING GROWS WITHOUT LIMIT AT THIS INCOME · THE SCHEDULE STOPS AT ${stopLabel}, BEFORE THE FIGURES STOP MEANING ANYTHING. Close the monthly gap (spend less or bring in more), or try a longer tenure in the what-if, to get a date.`
    : `THE DEBT DOESN’T CLEAR IN 30 YEARS AS THINGS STAND · THE SCHEDULE STOPS AT ${stopLabel}. Close the monthly gap (spend less or bring in more), or try a longer tenure in the what-if, to get a date.`;
}

/** Live re-test 2 R2-10: the plan and minimums lines are drawn one on top
 *  of the other (a short month leaves nothing extra to pay), so the legend
 *  shows one item and says so. Points are normalised 0..1. */
export function linesCoincide(points: { av: number; min: number }[], tol = 0.005): boolean {
  return points.length > 0 && points.every((p) => Math.abs(p.av - p.min) <= tol);
}
