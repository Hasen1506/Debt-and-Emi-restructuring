/**
 * The picture under a Plan what-if. Two bars scaled to whichever figure is
 * larger both ran the full width when the change was small (20 Oct 2026:
 * debt-free Dec 2026 either way, interest ₹8,815 against ₹8,707), so the
 * picture hid the only fact that mattered.
 *
 * A date that doesn't move is a sentence. Interest that barely moves is the
 * two amounts in words. A change you can see on a shared scale from zero
 * is a bar, with ₹0 (or NOW) marked at the left.
 */

/** A gap smaller than this, against the larger figure, still looks full. */
export const CLOSE_SHARE = 0.08;

/** Spend-less "From" choices: this month, and 3, 6 and 12 months out. */
export const SPEND_START_MONTHS = [1, 4, 7, 13] as const;

/** Floating-rate slider, in basis points. 100 bps = 1 percentage point. */
export const RATE_BPS = { min: -200, max: 300, step: 5 } as const;

export function clampWhatIf(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

export interface WhatIfPictureModel {
  /** Positive: the change clears the debts sooner. Null: one side has no date. */
  monthsSooner: number | null;
  /** Positive: less interest than the plan. */
  interestSaved: number;
  date:
    | { mode: 'same' | 'missing' }
    | { mode: 'axis'; maxMonth: number; planShare: number; nextShare: number };
  interest:
    | { mode: 'same' | 'close' }
    | { mode: 'scale'; max: number; planShare: number; nextShare: number };
}

export function buildWhatIfPicture(input: {
  planMonth: number | null;
  nextMonth: number | null;
  planInterest: number;
  nextInterest: number;
}): WhatIfPictureModel {
  const { planMonth, nextMonth, planInterest, nextInterest } = input;
  const monthsSooner = planMonth != null && nextMonth != null ? planMonth - nextMonth : null;
  const interestSaved = planInterest - nextInterest;
  let date: WhatIfPictureModel['date'];
  if (planMonth == null || nextMonth == null) date = { mode: 'missing' };
  else if (planMonth === nextMonth) date = { mode: 'same' };
  else {
    const maxMonth = Math.max(planMonth, nextMonth, 1);
    date = { mode: 'axis', maxMonth, planShare: planMonth / maxMonth, nextShare: nextMonth / maxMonth };
  }
  const max = Math.max(planInterest, nextInterest, 0);
  const gap = Math.abs(interestSaved);
  let interest: WhatIfPictureModel['interest'];
  if (gap < 0.5 || max === 0) interest = { mode: 'same' };
  else if (gap / max < CLOSE_SHARE) interest = { mode: 'close' };
  else interest = { mode: 'scale', max, planShare: planInterest / max, nextShare: nextInterest / max };
  return { monthsSooner, interestSaved, date, interest };
}

/** "₹24 less interest, same debt-free month." `money` is the screen's formatter. */
export function whatIfSentence(
  monthsSooner: number | null,
  interestSaved: number,
  money: (n: number) => string,
): string {
  const sameMoney = money(Math.abs(interestSaved)) === money(0);
  const interest = sameMoney
    ? 'Same interest'
    : `${money(Math.abs(interestSaved))} ${interestSaved > 0 ? 'less' : 'more'} interest`;
  if (monthsSooner == null) return `${interest}.`;
  const n = Math.abs(monthsSooner);
  const date =
    monthsSooner === 0
      ? 'same debt-free month'
      : `debt-free ${n} month${n === 1 ? '' : 's'} ${monthsSooner > 0 ? 'sooner' : 'later'}`;
  if (sameMoney && monthsSooner === 0) return 'Same interest, same debt-free month.';
  return `${interest}, ${date}.`;
}
