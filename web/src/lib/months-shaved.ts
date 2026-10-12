/**
 * "Months shaved off" (grill: fun, #2): how much sooner the debt-free date
 * is than it was, counted honestly.
 *
 * The trap: "months left" falls by one every month just because time
 * passes, so a counter built on it would celebrate doing nothing. This
 * compares calendar debt-free months instead. Each time Home shows a live
 * plan, the debt-free month (YYYY-MM) is remembered when it changes; the
 * counter then says how many calendar months earlier (or later) it is than
 * the last one and the first one. "34 → 31 months" is months from today to
 * the old date and to the new one, so both numbers use the same today.
 *
 * Stored on this device only (localStorage), at most 24 changes.
 */

export interface DebtFreeMark {
  /** The plan's debt-free month, "2033-05". */
  ym: string;
  /** The day it was first seen, "2026-10-12". */
  on: string;
}

export const MONTHS_SHAVED_KEY = 'rightdue_debt_free_marks';
const MAX_MARKS = 24;
const YM = /^\d{4}-(0[1-9]|1[0-2])$/;

export function ymIndex(ym: string): number {
  if (!YM.test(ym)) throw new Error(`bad month: ${ym}`);
  return Number(ym.slice(0, 4)) * 12 + Number(ym.slice(5, 7)) - 1;
}

/** Calendar months from a to b (b later = positive). */
export function monthsBetween(a: string, b: string): number {
  return ymIndex(b) - ymIndex(a);
}

/** The month index the engine reports (1 = this month) as "YYYY-MM". */
export function debtFreeYm(monthIndex: number, today: Date): string {
  const d = new Date(today.getFullYear(), today.getMonth() + monthIndex - 1, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Add today's date if it differs from the last one remembered. */
export function recordMark(marks: DebtFreeMark[], ym: string, onIso: string): DebtFreeMark[] {
  if (!YM.test(ym)) return marks;
  const last = marks[marks.length - 1];
  if (last && last.ym === ym) return marks;
  const next = [...marks, { ym, on: onIso }];
  // Keep the first (the baseline) and the latest changes.
  return next.length > MAX_MARKS ? [next[0], ...next.slice(next.length - MAX_MARKS + 1)] : next;
}

export interface Shaved {
  /** Calendar months sooner than the previous date (negative = later). */
  vsPrevious: number;
  /** Calendar months sooner than the first date remembered. */
  vsFirst: number;
  /** Months from today's month to the previous and the current date. */
  leftBefore: number;
  leftNow: number;
  previous: DebtFreeMark;
  first: DebtFreeMark;
}

/** Null until there are two different dates to compare. */
export function shaved(marks: DebtFreeMark[], todayYm: string): Shaved | null {
  if (marks.length < 2) return null;
  const now = marks[marks.length - 1];
  const previous = marks[marks.length - 2];
  const first = marks[0];
  return {
    vsPrevious: monthsBetween(now.ym, previous.ym),
    vsFirst: monthsBetween(now.ym, first.ym),
    leftBefore: Math.max(0, monthsBetween(todayYm, previous.ym)),
    leftNow: Math.max(0, monthsBetween(todayYm, now.ym)),
    previous,
    first,
  };
}

export function readMarks(): DebtFreeMark[] {
  try {
    const raw = JSON.parse(window.localStorage.getItem(MONTHS_SHAVED_KEY) || '[]');
    return Array.isArray(raw) ? raw.filter((m) => m && YM.test(m.ym) && typeof m.on === 'string') : [];
  } catch {
    return [];
  }
}

export function writeMarks(marks: DebtFreeMark[]): void {
  try {
    window.localStorage.setItem(MONTHS_SHAVED_KEY, JSON.stringify(marks));
  } catch {
    /* private mode: the counter starts again next visit */
  }
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function ymLabel(ym: string): string {
  return `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
}

/** One line for Home. */
export function shavedLine(s: Shaved): string {
  const n = Math.abs(s.vsPrevious);
  const mo = (k: number) => `${k} month${k === 1 ? '' : 's'}`;
  if (s.vsPrevious > 0) {
    const total = s.vsFirst > s.vsPrevious ? ` ${mo(s.vsFirst)} sooner than when you started.` : '';
    return `${s.leftBefore} → ${s.leftNow} months to debt-free: ${mo(n)} shaved off since ${ymLabel(s.previous.on.slice(0, 7))}.${total}`;
  }
  if (s.vsPrevious < 0) {
    return `${s.leftBefore} → ${s.leftNow} months to debt-free: ${mo(n)} later than before. A smaller payment logged, a rate rise or new spending moves the date.`;
  }
  return `Still on track for ${ymLabel(s.previous.ym)}.`;
}
