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
export function shortHeadline(args: ShortStoryArgs): { value: string; sub: string } {
  const { shortfall, asIsMonth, label, money, infeasibleFrom, laterGap } = args;
  const line = shortGapLine(args);
  if (line && shortfall > 0) {
    // Audit 80+ A5: short this month, the big figure is the gap, not the
    // date it would take to close it (that date is demoted to the line).
    return { value: shortValue(shortfall, money), sub: line.toUpperCase() };
  }
  // W1b / audit 80+ C11: a later month is short and can't be borrowed within
  // the gap credit limit, so the engine's date pays with money that can't be
  // found. Lead with that month's gap, never with the date.
  if (infeasibleFrom != null && laterGap && laterGap.amount > 0) {
    return {
      value: shortValue(laterGap.amount, money),
      sub: `FROM ${label(laterGap.month)} · ${notFundable(infeasibleFrom, label)}`.toUpperCase(),
    };
  }
  // Only a later month is short: the engine's date already borrows for it.
  return { value: asIsMonth ? label(asIsMonth) : 'NO DATE YET', sub: 'A LATER MONTH IS SHORT · GAP BORROWED' };
}

export interface ShortStoryArgs {
  shortfall: number;
  asIsMonth: number | null;
  closedMonth: number | null | undefined;
  label: (m: number) => string;
  money: (v: number) => string;
  /** Audit 80+ C11 (W1b): the engine's infeasible_from_month. Set, the
   *  as-is date is not shown: the plan isn't fundable from that month. */
  infeasibleFrom?: number | null;
  /** The first later month that is short, and by how much. */
  laterGap?: { month: number; amount: number };
}

/**
 * Integration phase 5 (C11 capped plans): the debt-free month a page may
 * show for an engine run. A capped run (infeasible_from_month set) clears
 * only on paper — from that month it pays with money that can be neither
 * found nor borrowed — so it has no debt-free month to show anywhere
 * (headline, chart milestone, schedule row, Home, Setup, payoff orders).
 */
export function shownDebtFreeMonth(r: {
  debt_free_month: number | null;
  infeasible_from_month?: number | null;
}): number | null {
  return r.infeasible_from_month != null ? null : r.debt_free_month;
}

/** Where a capped plan's schedule and chart stop: the first month it is
 *  not fundable. Null for a plan that isn't capped. */
export function cappedCut(infeasibleFrom: number | null | undefined): { month: number; growsWithoutLimit: false; notFundableFrom: number } | null {
  return infeasibleFrom != null ? { month: Math.max(1, infeasibleFrom), growsWithoutLimit: false, notFundableFrom: Math.max(1, infeasibleFrom) } : null;
}

/**
 * Integration phase 5: how a plan run ends, for every page that draws it
 * (Plan from /simulate in load-plan, the tenure what-if from /compare in
 * planWithWhatIf). One mapping, so a capped run can't get a date on one
 * page and not on another: debtFreeMonth (null when capped or never
 * clears), infeasibleFrom, and where the schedule/chart stop.
 */
export function planEnd(r: {
  debt_free_month: number | null;
  infeasible_from_month?: number | null;
  trajectory_cut_month?: number | null;
  never_clears?: boolean;
  grows_without_limit?: boolean;
}): {
  debtFreeMonth: number | null;
  infeasibleFrom: number | null;
  scheduleCut: { month: number | null; growsWithoutLimit: boolean; notFundableFrom?: number | null } | null;
} {
  return {
    debtFreeMonth: shownDebtFreeMonth(r),
    infeasibleFrom: r.infeasible_from_month ?? null,
    scheduleCut:
      cappedCut(r.infeasible_from_month) ??
      (r.debt_free_month == null && (r.trajectory_cut_month != null || r.never_clears)
        ? { month: r.trajectory_cut_month ?? null, growsWithoutLimit: !!r.grows_without_limit }
        : null),
  };
}

/** Integration phase 5: Setup's Debt-free row [value, note] for a capped plan
 *  that isn't short this month (null otherwise): the later gap, not a date. */
export function cappedRow(
  r: { infeasible_from_month?: number | null; shortfall?: string; trajectory: { month: number; shortfall?: string }[] },
  label: (m: number) => string,
  money: (v: number) => string,
): [string, string] | null {
  if (r.infeasible_from_month == null || Number(r.shortfall ?? 0) > 0) return null;
  const later = r.trajectory.find((p) => p.month > 1 && Number(p.shortfall) > 0);
  const nf = notFundable(r.infeasible_from_month, label);
  return later ? [`${money(Math.round(Number(later.shortfall)))}/mo short`, `from ${label(later.month)} · ${nf}`] : ['No date', nf];
}

/** W1b / C11: the words for a plan the gap credit limit can't carry. */
export function notFundable(month: number, label: (m: number) => string): string {
  return `not fundable as it stands from ${label(month)}`;
}

/** The same words after "as things stand:" (which already says "as it
 *  stands"), so the line doesn't repeat itself. */
function notFundableAsIs(month: number, label: (m: number) => string): string {
  return `not fundable from ${label(month)}`;
}

/** Live re-test 7 R7-2: the words for "no date as things stand", one
 *  phrase for Setup, Plan and Home (the plan looks 30 years ahead). */
export const AS_IS_NEVER = 'not in 30 years';

/**
 * Live test #16 / answers L2 #16, the founder rule, in ONE place
 * (live re-test 7 R7-2: Setup said "not in sight", Plan "NOT IN 30 YEARS"
 * and Home left the as-is date out). Short this month:
 *   "if the ₹X/mo gap closes · as things stand: <date>"
 * Audit 80+ A5 (Vijay: "makes sense -> do"): the gap-closed date moved
 * from the headline into this line, "if the ₹X/mo gap closes: <date> · ...".
 * and with no gap-closed date either:
 *   "short ₹X/mo · as things stand: <date>"
 * Sentence case; Plan and Home set it in capitals. Null when not short.
 */
/** Audit 80+ A5: the headline figure when this month is short ("₹5,500/MO SHORT"). */
export function shortValue(shortfall: number, money: (v: number) => string): string {
  return `${money(Math.round(shortfall))}/MO SHORT`;
}

export function shortGapLine(args: ShortStoryArgs): string | null {
  const { shortfall, asIsMonth, closedMonth, label, money, infeasibleFrom } = args;
  if (!(shortfall > 0)) return null;
  const asIs = infeasibleFrom != null ? notFundableAsIs(infeasibleFrom, label) : asIsMonth ? label(asIsMonth) : AS_IS_NEVER;
  // Audit 80+ A5: the gap-closed date lives here now (the headline is the gap).
  if (closedMonth) return `if the ${money(shortfall)}/mo gap closes: ${label(closedMonth)} · as things stand: ${asIs}`;
  // Live re-test L#16: the gap-closed run has no date either (later
  // months fall short again), so say so instead of half a template.
  return `short ${money(shortfall)}/mo · as things stand: ${asIs}${asIsMonth && infeasibleFrom == null ? '' : ' · no date even if this month’s gap closes'}`;
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
  /** Integration phase 5 (C11): a capped plan's first unfundable month.
   *  Past it the figures are paid with money that can't be found, so the
   *  axis ends there. */
  notFundableFrom?: number | null;
}): number {
  const { planClears, minClear, lastMonth, growingGapFrom, notFundableFrom } = args;
  if (notFundableFrom != null) return Math.max(1, Math.min(lastMonth, notFundableFrom));
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

/** The line under a schedule that stops (NEW-2). Integration phase 5 (C11):
 *  a capped plan stops at the month it stops being fundable and says so. */
export function scheduleStopLine(growsWithoutLimit: boolean, stopLabel: string, notFundableFrom?: boolean): string {
  if (notFundableFrom)
    return `NOT FUNDABLE FROM ${stopLabel} AS THINGS STAND · THE GAP CAN’T BE BORROWED PAST THE CARD LIMIT, SO THE SCHEDULE STOPS HERE AND THERE IS NO DEBT-FREE DATE. Close the monthly gap (spend less or bring in more), or try a longer tenure in the what-if, to get a date.`;
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
