/**
 * Choices only the person can make (sprint G10, grill #22; founder: "the
 * emergency fund target set as 6 months by default ... should be chosen by
 * the user; how much to divert to a goal, and so on").
 *
 * Setup used to save an emergency-fund target of 0, a 30% split and the
 * Avalanche order without asking. Each is now picked on setup's last step,
 * and the profile records that it was picked (assumptions.confirmed), so a
 * later screen can tell "you chose this" from "the app assumed this".
 * docs/SILENT-DEFAULTS.md lists every remaining default and who owns it.
 */
import type { UserPayload } from './api';
import type { StrategyName } from './strategy';

export type ChoiceKey = 'ef_months' | 'ef_split' | 'strategy';

export interface SetupChoices {
  /** Months of spending to keep as an emergency fund; 0 = not now. */
  efMonths: number | null;
  /** Share (0–1, as text) of spare cash that goes to the fund while it fills. */
  efSplit: string | null;
  strategy: StrategyName | null;
}

export const EF_MONTH_CHOICES = [0, 3, 6, 12] as const;

/**
 * Audit 80 B6: what step 3 starts on, so SAVE always works. The order starts
 * on the cheapest path, marked "recommended · change any time"; the fund
 * starts on "Not now" (a target of 0, i.e. no fund assumed). Both stay
 * visible and one tap changes them. FOUNDER: grill #22 asked that these be
 * the user's choice; they still are, but no longer a forced one.
 */
export function startingChoices(c: SetupChoices): SetupChoices {
  return { efMonths: c.efMonths ?? 0, efSplit: c.efSplit, strategy: c.strategy ?? 'avalanche' };
}
export const EF_SPLIT_CHOICES = ['0.20', '0.30', '0.50', '1.00'] as const;

/** What's still to pick, in screen order; the split is asked only when
 *  there's a fund to fill. */
export function missingChoices(c: SetupChoices, hasLoans = true): ChoiceKey[] {
  const out: ChoiceKey[] = [];
  if (c.efMonths == null) out.push('ef_months');
  // With no loans there's nothing to split spare cash against or to order.
  if (hasLoans && (c.efMonths ?? 0) > 0 && c.efSplit == null) out.push('ef_split');
  if (hasLoans && c.strategy == null) out.push('strategy');
  return out;
}

export const CHOICE_ERROR: Record<ChoiceKey, string> = {
  ef_months: 'Pick how many months of spending to keep aside, or Not now.',
  ef_split: 'Pick how much of your spare cash goes to the fund while it fills.',
  strategy: 'Pick the order your loans are paid off in.',
};

/** The choices as the profile saves them: the fund's target from the
 *  person's monthly spending, and a record of what they chose. */
export function applyChoices(user: UserPayload, c: SetupChoices, monthlySpend: number, today: string): UserPayload {
  // Nothing picked yet: the profile keeps what it had (a preview before
  // the person has chosen shows their saved target, not a made-up one).
  if (c.efMonths == null && c.efSplit == null && c.strategy == null) return user;
  const months = c.efMonths ?? 0;
  const confirmed = new Set(user.assumptions?.confirmed ?? []);
  if (c.efMonths != null) confirmed.add('ef_months');
  if (c.efSplit != null || months === 0) confirmed.add('ef_split');
  if (c.strategy != null) confirmed.add('strategy');
  return {
    ...user,
    efund_target: c.efMonths == null ? (user.efund_target ?? '0') : String(Math.max(0, Math.round(months * monthlySpend))),
    assumptions: {
      ...(user.assumptions ?? {}),
      ef_months: c.efMonths == null ? (user.assumptions?.ef_months ?? null) : months > 0 ? months : null,
      confirmed: Array.from(confirmed).sort(),
      confirmed_at: today,
    },
  };
}

/** The choices a saved profile already holds, for editing it again. */
export function choicesFrom(user: UserPayload | null, split: string, strategy: StrategyName): SetupChoices {
  const done = new Set(user?.assumptions?.confirmed ?? []);
  const months = user?.assumptions?.ef_months;
  return {
    efMonths: done.has('ef_months') ? (typeof months === 'number' ? months : 0) : null,
    efSplit: done.has('ef_split') ? split : null,
    strategy: done.has('strategy') ? strategy : null,
  };
}
