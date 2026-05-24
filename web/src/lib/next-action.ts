/**
 * Next-best-action ladder — produces the single most-important
 * recommendation for /plan's top-of-page card.
 *
 * The order IS the design: a fixed-precedence list, first match wins.
 * Safety (EF below floor) outranks data-hygiene (lifecycle confirm)
 * which outranks goal allocation. The fallback always returns
 * something celebratory + the next milestone date so the card is
 * never empty.
 *
 * Determinism matters: the same profile + goals + lifecycle state
 * must always produce the same NextAction, so the UI doesn't flicker
 * between equally-relevant suggestions. Order ties are broken by date
 * (earliest first) then by id (stable sort).
 *
 * v1 ships rules: EF top-up, lifecycle confirm, goal behind, fallback.
 * Deferred to v2: tax-year deadline, achievability-flip vs snapshot,
 * decision-log staleness — each needs additional infra (clock-aware
 * FY logic, last-visit snapshot, decision-log shape).
 */

import type { UserPayload } from './api';
import {
  earliestFeasibleMonths,
  monthsToTargetLabel,
} from './achievability';
import {
  type LifecycleEvent,
  LIFECYCLE_KIND_LABEL,
} from './lifecycle-events';
import { fundedAmount, monthsUntil, type Goal } from './goals';

export type NextActionArchetype =
  | 'ef_topup'
  | 'goal_behind'
  | 'on_track';

// Reserved for future rules — keeping the predicates documented so a
// later contributor doesn't surface them unconditionally:
//   - 'tax_year_deadline'    fires only on (country==IN && regime==old &&
//                            80C headroom > 0) or US Roth/HSA cutoff window
//   - 'lifecycle_confirm'    DROPPED in v1 — LifecycleArrivalPrompts on
//                            /plan already surfaces pending arrivals with
//                            inline Confirm / Postpone / Cancel actions,
//                            and our suggesting "go to /debts" is worse UX
//   - 'achievability_flip'   needs a last_visit_snapshot in localStorage
//   - 'decision_reconcile'   needs decision-log staleness predicate

export interface NextAction {
  archetype: NextActionArchetype;
  /** One-line, present-tense imperative for the card heading. */
  headline: string;
  /** One-line, factual reason — the "why this." */
  reason: string;
  /** Primary CTA label. */
  ctaLabel: string;
  /** Deep-link destination for the CTA. */
  ctaHref: string;
  /** Secondary CTA label — usually "Snooze 7 days" or similar. Optional. */
  secondaryLabel?: string;
  /** When true, the card is celebratory (no-action), not exhortative. */
  positive?: boolean;
}

export interface NextActionInput {
  user: UserPayload;
  goals: Goal[];
  contributionTotals: Record<string, number>;
  lifecycleEvents: LifecycleEvent[];
  /** Same number /plan shows on the KPI strip. */
  monthlySurplus: number;
  today?: Date;
}

const EF_FLOOR_MONTHS = 3;

/** Smallest EF floor — max(efund_target, 3 × monthly_expenses). When
 *  both are unset, returns 0 and the EF rule is skipped. */
function efFloor(user: UserPayload): number {
  const target = Number(user.efund_target || 0);
  const fixed = Number(user.fixed_expenses || 0);
  const variable = Number(user.variable_expenses || 0);
  const monthsFloor = (fixed + variable) * EF_FLOOR_MONTHS;
  return Math.max(target, monthsFloor);
}

function moneyShort(n: number, ccySym: string): string {
  if (n >= 1e7) return `${ccySym}${(n / 1e7).toFixed(1)}Cr`;
  if (n >= 1e5) return `${ccySym}${(n / 1e5).toFixed(1)}L`;
  if (n >= 1e3) return `${ccySym}${(n / 1e3).toFixed(0)}k`;
  return `${ccySym}${Math.round(n).toString()}`;
}

function dateLabel(months: number, today: Date): string {
  return monthsToTargetLabel(months, today);
}

export function computeNextAction(input: NextActionInput): NextAction {
  const today = input.today ?? new Date();
  const ccySym = input.user.country === 'IN' ? '₹' : '$';

  // ─── Rule 1: EF below floor ─────────────────────────────────────────────
  // Floor = max(stated efund_target, 3 × monthly expenses). Only fires
  // when the gap is meaningful — at least one month of expenses short.
  const efBalance = Number(input.user.efund_balance || 0);
  const floor = efFloor(input.user);
  const monthlyExpenses =
    Number(input.user.fixed_expenses || 0) +
    Number(input.user.variable_expenses || 0);
  const efGap = floor - efBalance;
  if (
    floor > 0 &&
    efGap > 0 &&
    monthlyExpenses > 0 &&
    efGap >= monthlyExpenses
  ) {
    return {
      archetype: 'ef_topup',
      headline: `Top up your emergency fund — short ${moneyShort(efGap, ccySym)}`,
      reason: `Your EF sits at ${moneyShort(efBalance, ccySym)} against a ${EF_FLOOR_MONTHS}-month floor of ${moneyShort(floor, ccySym)}. A shock right now would force new debt.`,
      ctaLabel: 'Adjust EF target',
      ctaHref: '/onboarding?step=cash',
      secondaryLabel: 'Snooze 7 days',
    };
  }

  // (Rule 4 — lifecycle confirm — dropped in v1: LifecycleArrivalPrompts
  // on /plan already surfaces pending arrivals with inline action buttons.
  // Re-surfacing them in NextAction would be redundant noise.)

  // ─── Rule 6: Goal behind (deadline < 12 months) ────────────────────────
  // For each active goal whose target is within a year, ask: can pure
  // surplus accumulation reach the required amount by then? If not, the
  // goal is behind and the user needs to either fund more, defer, or
  // shrink the amount. Picks the goal whose deadline is nearest.
  const nearGoals = input.goals
    .filter((g) => Number(g.amount || 0) > 0)
    .map((g) => ({ g, months: monthsUntil(g, today) }))
    .filter((x) => x.months > 0 && x.months <= 12)
    .sort((a, b) => a.months - b.months);
  for (const { g, months } of nearGoals) {
    const earliest = earliestFeasibleMonths({
      goal: g,
      savedSoFar: input.contributionTotals[g.id] ?? 0,
      monthlySurplus: input.monthlySurplus,
      efBalance,
      efTarget: floor,
      monthlyExpenses,
      liquidatableValue: 0,
      newLoanIndicativeRate: 0,
    });
    const behind = earliest === null || earliest > months;
    if (behind) {
      const required = fundedAmount(g);
      const saved = input.contributionTotals[g.id] ?? 0;
      const gap = Math.max(0, required - saved);
      const headlineDate = dateLabel(months, today);
      return {
        archetype: 'goal_behind',
        headline: `Goal "${g.label || 'unnamed'}" is behind for ${headlineDate}`,
        reason:
          earliest === null
            ? `Forward surplus alone can't fund the remaining ${moneyShort(gap, ccySym)}. Defer the date, lower the amount, or open the EF / portfolio sources.`
            : `Earliest feasible at current surplus is ${dateLabel(earliest, today)} — ${earliest - months} month${earliest - months === 1 ? '' : 's'} past the deadline.`,
        ctaLabel: 'Open on /goals',
        ctaHref: `/goals#goal-${g.id}`,
        secondaryLabel: 'Snooze 7 days',
      };
    }
  }

  // ─── Rule 8: Fallback — celebratory, next milestone ────────────────────
  // Pick the soonest upcoming reference point: nearest goal target, or
  // soonest planned lifecycle event in the future, whichever comes
  // first. Returns the on-track message either way.
  const futureGoal = input.goals
    .map((g) => ({ g, months: monthsUntil(g, today) }))
    .filter((x) => x.months > 0)
    .sort((a, b) => a.months - b.months)[0];
  const futureEvent = input.lifecycleEvents
    .filter((e) => e.status === 'planned' && e.effectiveDate > toIso(today))
    .sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate))[0];

  let milestone: string | null = null;
  if (futureGoal && futureEvent) {
    const goalIso = monthsToTargetLabel(futureGoal.months, today);
    milestone =
      goalIso <= futureEvent.effectiveDate
        ? `${futureGoal.g.label || 'goal'} target on ${goalIso}`
        : `${LIFECYCLE_KIND_LABEL[futureEvent.kind].toLowerCase()} on ${futureEvent.effectiveDate}`;
  } else if (futureGoal) {
    milestone = `${futureGoal.g.label || 'goal'} target on ${monthsToTargetLabel(futureGoal.months, today)}`;
  } else if (futureEvent) {
    milestone = `${LIFECYCLE_KIND_LABEL[futureEvent.kind].toLowerCase()} on ${futureEvent.effectiveDate}`;
  }

  return {
    archetype: 'on_track',
    headline: "You're on track.",
    reason: milestone
      ? `Next milestone: ${milestone}.`
      : 'No urgent decisions queued — the engine keeps the plan up to date in the background.',
    ctaLabel: 'View plan',
    ctaHref: '/plan',
    positive: true,
  };
}

function toIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
