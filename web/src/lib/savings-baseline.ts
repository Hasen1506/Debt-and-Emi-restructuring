/**
 * One savings baseline everywhere (Audit 80 B4, A22, E4).
 *
 * The landing page compares the plan with paying the same monthly total
 * smallest balance first: the order most people pick by instinct, so it is
 * "what you'd likely do without RightDue". The app used to lead with "vs
 * paying only minimums" ("28 yrs 5 mo sooner" for a 5-month payoff), which
 * is the most any plan could save, not a typical saving. That figure now
 * lives only inside a "worst case" expander, under its own name.
 *
 * Every screen that states a saving takes its words from here, and
 * web/tests/a80-w06-onboarding.cjs fails if "vs paying only minimums" shows
 * up as a headline anywhere else.
 */
export const LIKELY_LABEL = 'Vs what you\u2019d likely do without RightDue';
export const LIKELY_HOW = 'the same total each month, smallest balance first';
export const WORST_CASE_LABEL = 'Worst case: paying only the minimums';

export interface Outcome {
  debtFreeMonth: number | null;
  totalInterest: string | number;
}

export interface LikelySaving {
  /** Interest saved vs the likely baseline, ≥ 0 (0 = the same). */
  interest: number;
  /** Months sooner vs the likely baseline (0 = same month or unknown). */
  months: number;
  same: boolean;
}

/** The plan against the likely baseline (smallest first, same total). */
export function likelySaving(plan: Outcome, likely: Outcome | null | undefined): LikelySaving | null {
  if (!likely) return null;
  const pi = Number(plan.totalInterest);
  const li = Number(likely.totalInterest);
  if (!Number.isFinite(pi) || !Number.isFinite(li)) return null;
  const interest = Math.max(0, Math.round(li - pi));
  const months =
    plan.debtFreeMonth != null && likely.debtFreeMonth != null ? Math.max(0, likely.debtFreeMonth - plan.debtFreeMonth) : 0;
  return { interest, months, same: interest < 1 && months === 0 };
}

/** The one-line verdict, in the user's currency formatter. */
export function likelySavingText(s: LikelySaving | null, fc: (v: number) => string): string {
  if (!s) return '\u2014';
  if (s.same) return 'about the same';
  return `${fc(s.interest)} less${s.months > 0 ? ` \u00b7 ${s.months} mo sooner` : ''}`;
}
