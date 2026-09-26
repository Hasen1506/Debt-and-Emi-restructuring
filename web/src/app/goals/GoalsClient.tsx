'use client';

/**
 * Goals page client — list, edit, and run achievability checks on
 * user-defined goals. Surfaces all three tiers per goal so the user
 * can pick how they want to fund it before committing.
 *
 * Persistence: client-side localStorage via `goals.ts`. Server
 * re-hydration will land with auth.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import Decimal from 'decimal.js';
import { Field, InfoTip, Select } from '@/components/ToolPrimitives';
import {
  GOAL_PRESETS,
  type Goal,
  type GoalFundingSource,
  type GoalKind,
  applyPresetDefaults,
  blankGoal,
  compareGoalsForOrder,
  fundedAmount,
  monthsUntil,
  readGoalsClient,
  writeGoalsClient,
} from '@/lib/goals';
import {
  addContribution,
  readContributionsClient,
  removeContribution,
  totalsByGoal,
  writeContributionsClient,
  type GoalContributionEntry,
} from '@/lib/goal-contributions';
import {
  analyseGoal,
  computeShortfallLevers,
  earliestFeasibleMonths,
  monthsToTargetLabel,
  recommendedTier,
  type ShortfallLevers,
} from '@/lib/achievability';
import {
  planDefersForGoals,
  simMonthToCalendar,
  type GoalDeferResult,
} from '@/lib/goal-defer';
import { projectedLiquidatableValue } from '@/lib/asset-returns';
import { readDecisionsClient, recordDecision } from '@/lib/decisions';
import { commitExpenseReduction } from '@/lib/expense-commit';
import { loadProfileClient } from '@/lib/user-store';
import {
  TEMPLATE_CATALOGUE,
  type TemplateKind,
  expandTemplate,
} from '@/lib/life-templates';
import type { UserPayload } from '@/lib/api';

interface Props {
  user: UserPayload;
  lowestRates: Record<string, { bank: string | null; low: string | null }>;
  themeName: string;
}

const KIND_OPTIONS: { value: GoalKind; label: string }[] = [
  { value: 'birthday', label: 'Birthday party' },
  { value: 'travel', label: 'Travel / trip' },
  { value: 'wedding', label: 'Wedding' },
  { value: 'education', label: 'Child education' },
  { value: 'business_seed', label: 'Business seed capital' },
  { value: 'downpayment', label: 'Home downpayment' },
  { value: 'medical', label: 'Medical reserve' },
  { value: 'custom', label: 'Custom (free-form)' },
];

const FUNDING_LABELS: Record<GoalFundingSource, string> = {
  surplus: 'Monthly surplus',
  ef: 'Tap emergency fund',
  liquidation: 'Liquidate investments',
  new_loan: 'Take a new loan',
};

export function GoalsClient({ user: userProp, lowestRates }: Props) {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [contributions, setContributions] = useState<GoalContributionEntry[]>([]);
  // `user` is mirrored to local state so commits made on this page
  // (e.g. expense reductions) propagate to the derived surplus + tier
  // analysis on the next render. Without this, the server-passed
  // `user` prop stays frozen until a navigation refreshes it, and
  // the achievability re-evaluation would lag the actual mutation.
  const [user, setUser] = useState<UserPayload>(userProp);
  const ccySym = user.country === 'IN' ? '₹' : '$';
  // Captured once on mount. Two readers downstream:
  //   • The auto-defer write-back effect — without a stable today, a
  //     calendar rollover during a long session would churn the
  //     persisted YYYY-MM and trigger a re-write.
  //   • Every `monthsUntil(goal)` call inside this component tree —
  //     without a stable today, the "X months remaining" figure
  //     ticks down at midnight on the 1st, recomputing the achievability
  //     ladder and the funding rates mid-session.
  // The effect mount picks up the genuine new month on next page load.
  const todayRef = useRef(new Date());
  const today = todayRef.current;

  useEffect(() => {
    setGoals(readGoalsClient());
    setContributions(readContributionsClient());
  }, []);

  // Re-read the stored profile after any locally-applied mutation
  // (expense commit, future commit-style flows). Pulled into a
  // callback so leaf components can request a refresh without
  // knowing about the storage layer.
  function refreshUserFromStore() {
    setUser(loadProfileClient().user);
  }

  const savedByGoal = useMemo(() => totalsByGoal(contributions), [contributions]);

  function commitContributions(next: GoalContributionEntry[]) {
    setContributions(next);
    writeContributionsClient(next);
  }

  function logContribution(
    goalId: string,
    amount: string,
    date: string,
    source?: string,
  ) {
    commitContributions(
      addContribution(contributions, { goalId, amount, date, source }),
    );
  }

  function unlogContribution(id: string) {
    commitContributions(removeContribution(contributions, id));
  }

  /**
   * Apply an expense reduction the user committed to in the lever
   * panel. Mutates the stored profile via `commitExpenseReduction`
   * (which also writes a decision-log entry for the activity ledger
   * + audit trail) then refreshes local `user` state so the next
   * render's surplus + tier analysis reflects the cut.
   *
   * Returns true on success — callers can use it to switch a button
   * into a "committed" confirmation state without re-querying the
   * store.
   */
  function commitCut(monthlyDelta: number, goalId: string, goalLabel: string): boolean {
    if (monthlyDelta <= 0) return false;
    const result = commitExpenseReduction({ monthlyDelta, goalId, goalLabel });
    if (!result) return false;
    refreshUserFromStore();
    return true;
  }

  const surplus = useMemo(() => {
    const income = new Decimal(user.monthly_income || '0');
    const fixed = new Decimal(user.fixed_expenses || '0');
    const variable = new Decimal(user.variable_expenses || '0');
    const emi = (user.loans ?? []).reduce(
      (s, l) => s.plus(new Decimal(l.scheduled_emi || '0')),
      new Decimal(0),
    );
    return Math.max(0, Number(income.sub(fixed).sub(variable).sub(emi).toString()));
  }, [user]);

  /**
   * Auto-defer pass — for every goal with `autoDefer !== false`,
   * compute the latest funding-start month that still hits the
   * deadline (so debt prepay gets the full surplus until then). The
   * /goals page doesn't call /simulate directly today, so we
   * synthesize a flat surplus series from the current static
   * `surplus` figure. /plan still gets engine-truth fill rates;
   * this is purely for the suggestion shown on the goal card +
   * the funding_start_month_index we pass to the engine.
   *
   * Walking goals in user-effective priority order means each
   * goal's defer accounts for higher-priority goals' projected
   * draws (single-pass, no oscillation).
   */
  const deferPlan = useMemo(() => {
    const sorted = [...goals].sort(compareGoalsForOrder);
    const maxTarget = sorted.reduce(
      (m, g) => Math.max(m, monthsUntil(g, today)),
      0,
    );
    if (maxTarget === 0) {
      return {
        suggestionsByGoal: {} as Record<string, GoalDeferResult>,
        proposedContributionsByGoal: {} as Record<string, number[]>,
        orderedGoalIds: [] as string[],
        series: [] as number[],
      };
    }
    const series = new Array<number>(maxTarget).fill(surplus);
    const planned = planDefersForGoals(
      sorted.map((g) => ({
        id: g.id,
        targetMonthIndex: monthsUntil(g, today),
        requiredAmount: fundedAmount(g),
        savedSoFar: savedByGoal[g.id] ?? 0,
      })),
      series,
    );
    const suggestionsByGoal: Record<string, GoalDeferResult> = {};
    for (const r of planned.suggestions) suggestionsByGoal[r.goalId] = r;
    return {
      suggestionsByGoal,
      proposedContributionsByGoal: planned.proposedContributionsByGoal,
      orderedGoalIds: planned.orderedGoalIds,
      series,
    };
  }, [goals, surplus, savedByGoal, today]);
  const deferSuggestions = deferPlan.suggestionsByGoal;

  /**
   * For each goal, the slice of `proposedContributionsByGoal` that
   * belongs to higher-priority goals (those processed before it in
   * the defer planner's pass). Threaded into each card as
   * `priorGoalsContributionsByMonth` so achievability can sum
   * per-month leftovers instead of using the flat
   * `priorGoalsMonthlyDraw` approximation — correctly reclaims
   * surplus once a prior goal expires (target month passes).
   */
  const priorContribsByGoal = useMemo(() => {
    const out: Record<string, Record<string, number[]>> = {};
    const seen: Record<string, number[]> = {};
    for (const gid of deferPlan.orderedGoalIds) {
      out[gid] = { ...seen };
      const series = deferPlan.proposedContributionsByGoal[gid];
      if (series) seen[gid] = series;
    }
    return out;
  }, [deferPlan]);

  /**
   * Per-goal "average monthly draw taken by higher-priority claimants"
   * — used only for the description-line copy on the achievability
   * tier ("after the ₹X/mo your higher-priority goals take first").
   * The T1 math itself uses the per-month `priorContribsByGoal` series
   * above, which correctly handles deferred goals (concentrated late
   * draws) and prior-goal expiry. This average is purely a display
   * aid, computed by summing the per-month draws across THIS goal's
   * window and dividing by the window length. Deferred prior goals
   * therefore contribute their concentrated draws into the right
   * months instead of a misleading flat run-rate.
   */
  const priorDrawByGoal = useMemo(() => {
    const out: Record<string, number> = {};
    for (const g of goals) {
      const targetIdx = monthsUntil(g, today);
      if (targetIdx <= 0) {
        out[g.id] = 0;
        continue;
      }
      const priors = priorContribsByGoal[g.id] ?? {};
      let sum = 0;
      for (const arr of Object.values(priors)) {
        for (let m = 0; m < targetIdx; m++) {
          sum += arr[m] ?? 0;
        }
      }
      out[g.id] = sum / targetIdx;
    }
    return out;
  }, [goals, priorContribsByGoal, today]);

  /**
   * Persist auto-computed defer back to each goal when it differs
   * from what's stored. Guards prevent render loops: we only
   * `updateGoal` when the suggestion is non-null AND the goal has
   * `autoDefer !== false` AND the computed YYYY-MM differs from
   * the current `fundingStartMonth`. User overrides set autoDefer
   * to false, which skips the goal here.
   */
  useEffect(() => {
    let dirty = false;
    const next = goals.map((g) => {
      if (g.autoDefer === false) return g;
      const s = deferSuggestions[g.id];
      if (!s || s.unreachable) return g;
      const wanted =
        s.startMonthIndex > 0 ? simMonthToCalendar(s.startMonthIndex, today) : undefined;
      if (g.fundingStartMonth === wanted) return g;
      dirty = true;
      return { ...g, fundingStartMonth: wanted };
    });
    if (dirty) {
      setGoals(next);
      writeGoalsClient(next);
    }
  }, [deferSuggestions, goals, today]);

  const efBalance = Number(user.efund_balance || '0');
  const efTarget = Number(user.efund_target || '0');

  // Liquid assets are passed to the card; per-goal we compound forward
  // by months_until_target so T3 reflects what the portfolio will be
  // worth on the goal's due-date, not the captured `today`. Per-asset
  // CAGR override is honoured; otherwise country/asset-type defaults
  // from [[lib/asset-returns]] kick in.
  const liquidAssets = (user.assets ?? []).filter(
    (a) => a.user_marks_liquid !== false,
  );

  // Indicative T3 rate — pick the kind-most-likely loan type. We default
  // to personal_loan (highest-likelihood new-credit option for goal
  // shortfalls). Country fallback if rate-card lookup didn't populate.
  const indicativeRate = (() => {
    const r = lowestRates.personal?.low;
    if (r) return Number(r);
    return user.country === 'IN' ? 0.12 : 0.10;
  })();

  function updateGoals(next: Goal[]) {
    setGoals(next);
    writeGoalsClient(next);
  }

  function addGoal(kind: GoalKind) {
    const g = blankGoal(kind);
    updateGoals([...goals, g]);
    recordDecision(readDecisionsClient(), {
      kind: 'goal_added',
      label: `Added ${KIND_OPTIONS.find((o) => o.value === kind)?.label} goal`,
      snapshot: { goalCount: goals.length },
      result: { goalCount: goals.length + 1, kind },
      impactDeltaMonths: null,
    });
  }

  function applyTemplate(kind: TemplateKind) {
    const ageMap: Record<string, number> = {
      under_25: 22,
      '25_35': 30,
      '35_50': 42,
      '50_plus': 55,
    };
    const currentAge = user.age_bracket ? ageMap[user.age_bracket] : 30;
    const monthlyExpenses =
      Number(user.fixed_expenses || '0') + Number(user.variable_expenses || '0');
    const expanded = expandTemplate({
      kind,
      currentAge,
      monthlyExpenses: monthlyExpenses || undefined,
    });
    updateGoals([...goals, ...expanded.goals]);
    if (typeof window !== 'undefined') {
      const lines = [expanded.summary, '', ...expanded.caveats.map((c) => `• ${c}`)].join('\n');
      window.alert(lines);
    }
  }

  function updateGoal(id: string, patch: Partial<Goal>) {
    updateGoals(
      goals.map((g) => {
        if (g.id !== id) return g;
        if (patch.kind && patch.kind !== g.kind) {
          // Switching kind resets defaults to the new preset.
          return applyPresetDefaults({ ...g, ...patch }, patch.kind);
        }
        return { ...g, ...patch };
      }),
    );
  }

  function removeGoal(id: string) {
    const g = goals.find((x) => x.id === id);
    updateGoals(goals.filter((x) => x.id !== id));
    if (g) {
      recordDecision(readDecisionsClient(), {
        kind: 'goal_removed',
        label: `Removed goal: ${g.label || g.kind}`,
        snapshot: { goal: g },
        result: { goalId: id },
        impactDeltaMonths: null,
      });
    }
  }

  function toggleFunding(id: string, src: GoalFundingSource) {
    const g = goals.find((x) => x.id === id);
    if (!g) return;
    const has = g.fundingSources.includes(src);
    updateGoal(id, {
      fundingSources: has
        ? g.fundingSources.filter((s) => s !== src)
        : [...g.fundingSources, src],
    });
  }

  return (
    <div style={{ maxWidth: 980, margin: '24px auto', padding: '0 16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <h1 style={{ fontSize: 22, fontWeight: 600 }}>Goals</h1>
        <Link href="/plan" style={{ color: 'var(--accent)', fontSize: 13 }}>
          Back to plan →
        </Link>
      </div>

      <p style={{ color: 'var(--muted)', maxWidth: 720, marginTop: 8, lineHeight: 1.5 }}>
        Time-boxed savings targets — birthday, travel, downpayment, medical
        reserve, custom. For each goal we check whether your current surplus
        gets you there by the target month, then surface the alternatives
        (EF tap, liquidation, new loan) when surplus alone isn&apos;t enough.
      </p>

      {goals.length === 0 && (
        <EmptyState onPick={(k) => addGoal(k)} />
      )}

      <section
        style={{
          marginTop: 20,
          padding: 14,
          border: '1px dashed var(--border)',
          borderRadius: 8,
          background: 'var(--soft-bg)',
        }}
      >
        <div style={{ fontWeight: 600, marginBottom: 6 }}>
          Life templates
          <InfoTip>
            <strong>What these are.</strong> Big multi-step goals
            (&quot;FIRE by 35&quot;, &quot;buy a home in 5 years&quot;)
            decomposed into the smaller, dated goals that compose them.
            <br />
            <br />
            Pick a template; we add 1–3 atomic goals to your list with
            sensible defaults derived from your profile. Edit each one
            freely after — templates are pure expansion, not bindings.
          </InfoTip>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {TEMPLATE_CATALOGUE.map((t) => (
            <button
              key={t.kind}
              type="button"
              onClick={() => applyTemplate(t.kind)}
              style={{
                padding: '10px 14px',
                border: '1px solid var(--border)',
                background: 'var(--card)',
                color: 'var(--ink)',
                borderRadius: 6,
                fontSize: 12,
                cursor: 'pointer',
                maxWidth: 220,
                textAlign: 'left',
              }}
            >
              <strong>{t.label}</strong>
              <div className="muted" style={{ marginTop: 4, fontSize: 11 }}>
                {t.description}
              </div>
            </button>
          ))}
        </div>
      </section>


      {goals.map((g) => (
        <GoalCard
          key={g.id}
          goal={g}
          today={today}
          ccySym={ccySym}
          monthlySurplus={surplus}
          efBalance={efBalance}
          efTarget={efTarget}
          liquidatableValue={projectedLiquidatableValue(
            liquidAssets,
            user.country,
            monthsUntil(g, today),
          )}
          indicativeRate={indicativeRate}
          indicativeBank={lowestRates.personal?.bank ?? null}
          savedSoFar={savedByGoal[g.id] ?? 0}
          priorGoalsMonthlyDraw={priorDrawByGoal[g.id] ?? 0}
          monthlySurplusSeries={deferPlan.series}
          priorGoalsContributionsByMonth={priorContribsByGoal[g.id] ?? {}}
          contributions={contributions.filter((c) => c.goalId === g.id)}
          deferSuggestion={deferSuggestions[g.id] ?? null}
          onPatch={(patch) => updateGoal(g.id, patch)}
          onToggleFunding={(src) => toggleFunding(g.id, src)}
          onRemove={() => removeGoal(g.id)}
          onLogContribution={(amount, date, source) =>
            logContribution(g.id, amount, date, source)
          }
          onUnlogContribution={unlogContribution}
          totalExpenses={
            Number(user.fixed_expenses || '0') + Number(user.variable_expenses || '0')
          }
          onCommitExpenseCut={(monthlyDelta) =>
            commitCut(monthlyDelta, g.id, g.label || GOAL_PRESETS[g.kind].label)
          }
        />
      ))}

      {goals.length > 0 && (
        <div style={{ marginTop: 16, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={() => addGoal('custom')}
            style={{
              padding: '8px 14px',
              border: '1px dashed var(--border)',
              background: 'transparent',
              color: 'var(--accent)',
              borderRadius: 6,
              cursor: 'pointer',
            }}
          >
            + Add another goal
          </button>
        </div>
      )}
    </div>
  );
}

function EmptyState({ onPick }: { onPick: (k: GoalKind) => void }) {
  return (
    <div
      style={{
        marginTop: 24,
        padding: 20,
        border: '1px dashed var(--border)',
        borderRadius: 8,
        background: 'var(--soft-bg)',
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 8 }}>Pick a goal to start.</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {KIND_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => onPick(opt.value)}
            style={{
              padding: '6px 12px',
              border: '1px solid var(--border)',
              background: 'var(--card)',
              color: 'var(--ink)',
              borderRadius: 16,
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function GoalCard({
  goal,
  today,
  ccySym,
  monthlySurplus,
  efBalance,
  efTarget,
  liquidatableValue,
  indicativeRate,
  indicativeBank,
  savedSoFar,
  priorGoalsMonthlyDraw,
  monthlySurplusSeries,
  priorGoalsContributionsByMonth,
  contributions,
  deferSuggestion,
  onPatch,
  onToggleFunding,
  onRemove,
  onLogContribution,
  onUnlogContribution,
  totalExpenses,
  onCommitExpenseCut,
}: {
  goal: Goal;
  /** Shared "now" anchor captured once on parent mount — keeps every
   *  monthsUntil call within the page in agreement across renders,
   *  including across a calendar-day rollover during a long session. */
  today: Date;
  ccySym: string;
  monthlySurplus: number;
  efBalance: number;
  efTarget: number;
  liquidatableValue: number;
  indicativeRate: number;
  indicativeBank: string | null;
  savedSoFar: number;
  priorGoalsMonthlyDraw: number;
  monthlySurplusSeries: number[];
  priorGoalsContributionsByMonth: Record<string, number[]>;
  contributions: GoalContributionEntry[];
  deferSuggestion: GoalDeferResult | null;
  onPatch: (patch: Partial<Goal>) => void;
  onToggleFunding: (src: GoalFundingSource) => void;
  onRemove: () => void;
  onLogContribution: (amount: string, date: string, source?: string) => void;
  onUnlogContribution: (id: string) => void;
  totalExpenses: number;
  onCommitExpenseCut: (monthlyDelta: number) => boolean;
}) {
  const preset = GOAL_PRESETS[goal.kind];
  const months = monthsUntil(goal, today);
  const required = fundedAmount(goal);

  const achievabilityInput = {
    goal,
    savedSoFar,
    monthlySurplus,
    efBalance,
    efTarget,
    monthlyExpenses: totalExpenses,
    priorGoalsMonthlyDraw,
    monthlySurplusSeries,
    priorGoalsContributionsByMonth,
    // /goals synthesises a flat surplus series from the current
    // monthly figure — `seriesQuality: 'flat'` tells analyseGoal to
    // describe the tier as "your current surplus held steady" rather
    // than "projected cashflow". /plan, when it adopts this surface,
    // should pass 'live' so the description reflects engine truth.
    seriesQuality: 'flat' as const,
    liquidatableValue,
    newLoanIndicativeRate: indicativeRate,
  };
  const tiers = analyseGoal(achievabilityInput);
  const rec = recommendedTier(tiers);
  // Only compute "honest" levers when the recommended path falls short
  // — feasible goals don't need them, and avoiding the call keeps the
  // common-case render cheap.
  const levers: ShortfallLevers | null = rec.achievable
    ? null
    : computeShortfallLevers(achievabilityInput);
  // Earliest month forward surplus alone could fund this goal — the
  // optimal-timeline chip shown next to the user's target-date field.
  // Suppresses when the user's chosen date matches the earliest (no
  // earlier date to suggest) and when the answer is null (infeasible).
  const earliestMonths = earliestFeasibleMonths(achievabilityInput);
  const earliestLabel =
    earliestMonths !== null && earliestMonths > 0 && earliestMonths < months
      ? monthsToTargetLabel(earliestMonths, today)
      : null;

  return (
    <section
      style={{
        marginTop: 16,
        padding: 16,
        border: '1px solid var(--border)',
        borderRadius: 8,
        background: 'var(--card)',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ flex: 1 }}>
          <strong style={{ fontSize: 15 }}>{goal.label || '(unnamed)'} </strong>
          <span style={{ color: 'var(--muted)', fontSize: 12, marginLeft: 4 }}>
            · {KIND_OPTIONS.find((o) => o.value === goal.kind)?.label}
          </span>
          {goal.priorityBump && (
            <span
              style={{
                marginLeft: 8,
                padding: '1px 6px',
                fontSize: 10,
                fontWeight: 600,
                color: 'var(--accent)',
                border: '1px solid var(--accent)',
                borderRadius: 3,
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
              }}
            >
              Bumped
            </span>
          )}
          <FillRateBadge
            goal={goal}
            today={today}
            required={required}
            savedSoFar={savedSoFar}
            projectedFillRate={
              required > 0 ? Math.min(1, rec.reachable / required) : 0
            }
            projectedFunded={rec.achievable}
          />
          <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
            {preset.description}
          </div>
        </div>
        <button
          type="button"
          onClick={onRemove}
          style={{
            padding: '4px 10px',
            border: '1px solid var(--negative)',
            background: 'transparent',
            color: 'var(--negative)',
            borderRadius: 4,
            fontSize: 12,
            cursor: 'pointer',
            height: 28,
          }}
        >
          Remove
        </button>
      </div>

      <FundingSchedulePanel
        goal={goal}
        ccySym={ccySym}
        months={months}
        required={required}
        savedSoFar={savedSoFar}
        monthlySurplus={monthlySurplus}
        priorGoalsMonthlyDraw={priorGoalsMonthlyDraw}
        deferSuggestion={deferSuggestion}
        onUseAutoDefer={() =>
          onPatch({ autoDefer: true, fundingStartMonth: undefined })
        }
        onStartNow={() =>
          onPatch({ autoDefer: false, fundingStartMonth: undefined })
        }
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
        <Select
          label="Kind"
          value={goal.kind}
          onChange={(v) => onPatch({ kind: v as GoalKind })}
          options={KIND_OPTIONS}
        />
        <Field
          label="Label"
          value={goal.label}
          onChange={(v) => onPatch({ label: v })}
          hint="e.g. 'Son's 5th birthday', 'Goa trip'"
        />
        <Field
          label={`Amount (${ccySym})`}
          value={goal.amount}
          onChange={(v) => onPatch({ amount: v })}
          hint={`Buffer of ${(Number(goal.bufferPct) * 100).toFixed(0)}% added on top`}
        />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <Field
            label="Target month (YYYY-MM)"
            value={goal.targetMonth}
            onChange={(v) => onPatch({ targetMonth: v })}
            hint={`${months} months from now`}
          />
          {earliestMonths === null ? (
            <span style={{ fontSize: 11, color: 'var(--warning, var(--negative))' }}>
              Forward surplus alone can&apos;t fund this — see options below.
            </span>
          ) : earliestLabel ? (
            <button
              type="button"
              onClick={() => onPatch({ targetMonth: earliestLabel })}
              style={{
                fontSize: 11,
                background: 'transparent',
                border: 'none',
                color: 'var(--accent)',
                padding: 0,
                cursor: 'pointer',
                textAlign: 'left',
                alignSelf: 'flex-start',
              }}
              title="Set the target to the earliest month forward surplus alone can reach"
            >
              Earliest feasible: {earliestLabel} ↺
            </button>
          ) : null}
        </div>
        <Field
          label="Buffer % (decimal)"
          value={goal.bufferPct}
          onChange={(v) => onPatch({ bufferPct: v })}
          hint="0.10 = 10% extra on top of target amount"
        />
      </div>

      <div>
        <label style={{ fontSize: 12, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
          <input
            type="checkbox"
            checked={goal.priorityBump}
            onChange={(e) => onPatch({ priorityBump: e.target.checked })}
          />
          Bump priority
          <InfoTip>
            By default, goals are funded in target-date order — earliest
            first. Check this if this goal matters more than its date
            suggests (e.g. a medical reserve due in 18 months that should
            beat a vacation due in 6). Bumped goals are funded ahead of
            earlier-dated ones; you can also drag a goal on the /plan
            waterfall to toggle this.
          </InfoTip>
        </label>
        <label style={{ fontSize: 12, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
          <input
            type="checkbox"
            checked={(goal.deadlineKind ?? 'soft') === 'hard'}
            onChange={(e) =>
              onPatch({ deadlineKind: e.target.checked ? 'hard' : 'soft' })
            }
          />
          Date is locked (can&apos;t be slipped)
          <InfoTip>
            Use this for fixed dates you genuinely can&apos;t move — wedding,
            school admission cutoff, court-ordered medical. The shortfall
            adviser will hide the &quot;push the date out&quot; option and
            surface only lever options that respect the locked date (lower
            the amount, increase surplus, tap EF/portfolio). Leave off for
            preferred-but-movable targets — that&apos;s the default for
            most goals.
          </InfoTip>
        </label>
        <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <span style={{ fontSize: 12, color: 'var(--muted)', marginRight: 4 }}>
            Funding sources allowed:
          </span>
          {(Object.keys(FUNDING_LABELS) as GoalFundingSource[]).map((src) => {
            const on = goal.fundingSources.includes(src);
            return (
              <button
                key={src}
                type="button"
                onClick={() => onToggleFunding(src)}
                style={{
                  padding: '4px 10px',
                  border: `1px solid ${on ? 'var(--accent)' : 'var(--border)'}`,
                  background: on ? 'var(--accent)' : 'transparent',
                  color: on ? 'var(--canvas)' : 'var(--ink)',
                  borderRadius: 12,
                  fontSize: 12,
                  cursor: 'pointer',
                }}
              >
                {FUNDING_LABELS[src]}
              </button>
            );
          })}
        </div>
      </div>

      <ContributionsPanel
        ccySym={ccySym}
        savedSoFar={savedSoFar}
        required={required}
        contributions={contributions}
        onLog={onLogContribution}
        onUnlog={onUnlogContribution}
      />

      <Achievability
        tiers={tiers}
        rec={rec}
        levers={levers}
        deadlineKind={goal.deadlineKind ?? 'soft'}
        ccySym={ccySym}
        indicativeBank={indicativeBank}
        required={required}
        goalAmount={goal.amount}
        totalExpenses={totalExpenses}
        onCommitExpenseCut={onCommitExpenseCut}
        priorityBump={goal.priorityBump}
        onBumpPriority={() => onPatch({ priorityBump: true })}
      />
    </section>
  );
}

/**
 * Goal contributions ledger UI. Per-goal "I put ₹X in on date Y" log.
 *
 * Two responsibilities:
 *   1. Show saved-so-far / required progress so the user can see how
 *      close they are without doing arithmetic.
 *   2. Capture new contributions inline (amount + date + optional
 *      source) so the cookie digest mirror updates → the engine's
 *      next /plan render sees a lower run-rate.
 *
 * Past entries get a remove affordance — corrections are common when
 * users mis-log amounts or dates.
 */
function ContributionsPanel({
  ccySym,
  savedSoFar,
  required,
  contributions,
  onLog,
  onUnlog,
}: {
  ccySym: string;
  savedSoFar: number;
  required: number;
  contributions: GoalContributionEntry[];
  onLog: (amount: string, date: string, source?: string) => void;
  onUnlog: (id: string) => void;
}) {
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [source, setSource] = useState('');
  const progressPct =
    required > 0 ? Math.min(100, Math.round((savedSoFar / required) * 100)) : 0;

  function submit() {
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) return;
    onLog(amount, date, source || undefined);
    setAmount('');
    setSource('');
  }

  return (
    <div
      style={{
        padding: 12,
        background: 'var(--soft-bg)',
        border: '1px solid var(--border)',
        borderRadius: 6,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          gap: 8,
          alignItems: 'baseline',
          flexWrap: 'wrap',
        }}
      >
        <div>
          <div className="muted" style={{ fontSize: 11, letterSpacing: '0.06em' }}>
            SAVED SO FAR
          </div>
          <div style={{ fontSize: 15, fontWeight: 600 }}>
            {ccySym}
            {Math.round(savedSoFar).toLocaleString()}{' '}
            <span className="muted" style={{ fontSize: 12, fontWeight: 400 }}>
              / {ccySym}
              {Math.round(required).toLocaleString()} ({progressPct}%)
            </span>
          </div>
        </div>
        <div
          style={{
            flex: '0 0 200px',
            height: 6,
            background: 'var(--border)',
            borderRadius: 3,
            overflow: 'hidden',
            alignSelf: 'center',
          }}
        >
          <div
            style={{
              width: `${progressPct}%`,
              height: '100%',
              background: progressPct >= 100 ? 'var(--positive)' : 'var(--accent)',
            }}
          />
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr 1fr auto',
          gap: 8,
          alignItems: 'end',
        }}
      >
        <Field
          label={`Amount (${ccySym})`}
          value={amount}
          onChange={setAmount}
          hint="One-time contribution"
          kind="decimal"
        />
        <Field
          label="Date (YYYY-MM-DD)"
          value={date}
          onChange={setDate}
          hint="When it actually moved"
          kind="date"
        />
        <Field
          label="Source"
          value={source}
          onChange={setSource}
          hint="surplus / bonus / gift / sold X"
        />
        <button
          type="button"
          onClick={submit}
          disabled={!amount || Number(amount) <= 0}
          style={{
            padding: '8px 14px',
            border: '1px solid var(--ink)',
            background: 'var(--ink)',
            color: 'var(--canvas)',
            borderRadius: 4,
            fontSize: 12,
            cursor: amount && Number(amount) > 0 ? 'pointer' : 'not-allowed',
            opacity: amount && Number(amount) > 0 ? 1 : 0.5,
            height: 34,
          }}
        >
          + Log
        </button>
      </div>

      {contributions.length > 0 && (
        <ul
          style={{
            listStyle: 'none',
            padding: 0,
            margin: 0,
            fontSize: 12,
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
          }}
        >
          {contributions.slice(0, 6).map((c) => (
            <li
              key={c.id}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                gap: 8,
                padding: '4px 8px',
                background: 'var(--card)',
                borderRadius: 4,
              }}
            >
              <span>
                {c.date} ·{' '}
                <strong>
                  {ccySym}
                  {Number(c.amount).toLocaleString()}
                </strong>
                {c.source ? (
                  <span className="muted"> · {c.source}</span>
                ) : null}
              </span>
              <button
                type="button"
                onClick={() => onUnlog(c.id)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--negative)',
                  cursor: 'pointer',
                  fontSize: 11,
                  padding: 0,
                }}
                aria-label="Remove contribution"
              >
                ✕
              </button>
            </li>
          ))}
          {contributions.length > 6 && (
            <li className="muted" style={{ fontSize: 11 }}>
              +{contributions.length - 6} older entries
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

function Achievability({
  tiers,
  rec,
  levers,
  deadlineKind,
  ccySym,
  indicativeBank,
  required,
  goalAmount,
  totalExpenses,
  onCommitExpenseCut,
  priorityBump,
  onBumpPriority,
}: {
  tiers: ReturnType<typeof analyseGoal>;
  rec: ReturnType<typeof recommendedTier>;
  levers: ShortfallLevers | null;
  deadlineKind: 'hard' | 'soft';
  ccySym: string;
  indicativeBank: string | null;
  required: number;
  goalAmount: string;
  totalExpenses: number;
  onCommitExpenseCut: (monthlyDelta: number) => boolean;
  /** Current priority-bump state of this goal — hides the bump lever
   *  when already true. */
  priorityBump: boolean;
  /** One-click action to flip priorityBump on. The bump lever calls
   *  this; the recommendation panel exposes the same action so the
   *  user doesn't have to find the toggle higher up the form. */
  onBumpPriority: () => void;
}) {
  // Identify whether T3 (or rec) leans on liquidation — that's the
  // signal to surface the portfolio-advisor CTA.
  const liquidationSource = rec.sources.find(
    (s) => s.source === 'liquidation' && s.contributes > 0,
  );
  const showAdvisorCta = liquidationSource && !rec.achievable;
  return (
    <div
      style={{
        padding: 12,
        background: 'var(--soft-bg)',
        border: '1px solid var(--border)',
        borderRadius: 6,
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 4 }}>
        Required: {ccySym}
        {Math.round(required).toLocaleString()}
      </div>
      <div style={{ fontSize: 12, color: rec.achievable ? 'var(--positive)' : 'var(--negative)' }}>
        Recommended path: <strong>{rec.tier}</strong> ·{' '}
        {rec.achievable ? 'achievable' : `${ccySym}${Math.round(rec.shortfall).toLocaleString()} short`}
      </div>
      {levers && (
        <ShortfallLeverPanel
          levers={levers}
          deadlineKind={deadlineKind}
          ccySym={ccySym}
          totalExpenses={totalExpenses}
          onCommitExpenseCut={onCommitExpenseCut}
          priorityBump={priorityBump}
          onBumpPriority={onBumpPriority}
        />
      )}
      {showAdvisorCta && (
        <div
          style={{
            marginTop: 8,
            padding: 10,
            borderLeft: '3px solid var(--accent)',
            background: 'var(--card)',
            fontSize: 12,
          }}
        >
          Liquidation is part of the recommended path. Run the{' '}
          <Link
            href={`/tools/liquidate?required=${Math.round(rec.shortfall)}&context=${encodeURIComponent(`Goal: ${goalAmount}`)}`}
            style={{ color: 'var(--accent)' }}
          >
            portfolio advisor →
          </Link>{' '}
          to get an ordered sell list (lowest-tax, lowest-disruption first).
        </div>
      )}
      <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {tiers.map((t, idx) => {
          // Delta framing — for tiers beyond T1, show what this tier
          // gives you over the previous (cheaper) tier instead of just
          // an absolute "X reachable." Helps the user judge whether
          // the extra unlock (EF tap / liquidation / new loan) is
          // worth it for the marginal capacity it adds.
          const prev = idx > 0 ? tiers[idx - 1] : null;
          const delta = prev ? Math.max(0, t.reachable - prev.reachable) : 0;
          return (
            <div
              key={t.tier}
              style={{
                padding: 8,
                border: `1px solid ${t === rec ? 'var(--accent)' : 'var(--border)'}`,
                borderRadius: 4,
                background: 'var(--card)',
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 600 }}>
                {t.tier} — {t.achievable ? '✓ achievable' : `${ccySym}${Math.round(t.shortfall).toLocaleString()} short`}
                <span style={{ color: 'var(--muted)', fontSize: 12, fontWeight: 400, marginLeft: 8 }}>
                  reachable {ccySym}{Math.round(t.reachable).toLocaleString()}
                  {prev && delta > 0 && (
                    <> · +{ccySym}{Math.round(delta).toLocaleString()} vs {prev.tier}</>
                  )}
                </span>
              </div>
              <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                {t.description}
                {t.tier === 'T3' && indicativeBank && t.sources.some((s) => s.source === 'new_loan' && s.contributes > 0) && (
                  <> · cheapest indicative quote from <strong>{indicativeBank}</strong>.</>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Honest "can't afford this on the current plan" framing. Shown only
 * when no tier reaches the goal. Surfaces three levers side by side so
 * the user picks which to pull rather than being told "no":
 *
 *   • Push the date out by N months (keep target + surplus).
 *   • Lower the target by X (keep date + surplus).
 *   • Increase surplus by Y/mo (keep date + target).
 *
 * Read-only by design — applying the chosen lever is the user's call.
 * Editing the goal fields directly above re-runs the analysis on the
 * next render, so the lever values update in place.
 */
function ShortfallLeverPanel({
  levers,
  deadlineKind,
  ccySym,
  totalExpenses,
  onCommitExpenseCut,
  priorityBump,
  onBumpPriority,
}: {
  levers: ShortfallLevers;
  deadlineKind: 'hard' | 'soft';
  ccySym: string;
  totalExpenses: number;
  onCommitExpenseCut: (monthlyDelta: number) => boolean;
  priorityBump: boolean;
  onBumpPriority: () => void;
}) {
  // Hard deadlines (wedding, school admission) can't be slipped — so
  // we drop the "push the date out" lever entirely rather than offer
  // an answer the user can't use. The other two levers still apply.
  const extendDisabled =
    deadlineKind === 'hard' ||
    levers.extendMonthsBy == null ||
    levers.extendMonthsBy === 0;
  const showsExtend = deadlineKind !== 'hard';
  const bumpAvailable = !priorityBump && levers.bumpPriorityGain > 0;
  const hasAnyPath =
    (!extendDisabled) ||
    levers.lowerTargetBy > 0 ||
    levers.increaseSurplusBy > 0 ||
    levers.increaseSurplusByWithLumpSum > 0 ||
    bumpAvailable;
  if (!hasAnyPath) {
    return (
      <div
        style={{
          marginTop: 8,
          padding: 10,
          border: '1px solid var(--negative)',
          borderRadius: 4,
          fontSize: 12,
          color: 'var(--negative)',
          lineHeight: 1.5,
        }}
      >
        This goal isn&apos;t reachable on any current source — even with
        unlimited time. Add a funding source above, or widen the EF tap
        floor by reducing the EF target.
      </div>
    );
  }

  // When the surplus-only lever differs from the with-lump-sum lever,
  // show both so the user can compare. They differ only when EF /
  // liquidation are toggled on AND have non-zero balances.
  const showsBothSurplusLevers =
    levers.increaseSurplusByWithLumpSum > 0 &&
    levers.increaseSurplusByWithLumpSum !== levers.increaseSurplusBy;
  const surplusCols =
    showsExtend ? (showsBothSurplusLevers ? 4 : 3) : (showsBothSurplusLevers ? 3 : 2);
  return (
    <div
      style={{
        marginTop: 10,
        padding: 10,
        background: 'var(--card)',
        border: '1px solid var(--border)',
        borderRadius: 4,
      }}
    >
      <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6 }}>
        What would make this work?
        {deadlineKind === 'hard' && (
          <span style={{ marginLeft: 6, fontStyle: 'italic' }}>
            (date is locked — extend lever hidden)
          </span>
        )}
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${surplusCols}, 1fr)`,
          gap: 8,
          fontSize: 12,
        }}
      >
        {showsExtend && (
          <Lever
            label="Push the date out"
            value={
              levers.extendMonthsBy != null && levers.extendMonthsBy > 0
                ? `+${levers.extendMonthsBy} months`
                : levers.extendMonthsBy === 0
                  ? 'no extra months needed'
                  : 'not enough inflow'
            }
            subtle={
              levers.extendMonthsBy == null
                ? 'Need additional inflow to ever close.'
                : levers.extendMonthsBy === 0
                  ? 'Lump-sum sources alone close the gap.'
                  : 'Same target, same surplus — later finish.'
            }
            disabled={extendDisabled}
          />
        )}
        <Lever
          label="Lower the target"
          value={`-${ccySym}${levers.lowerTargetBy.toLocaleString()}`}
          subtle="Trim scope to fit the current date + sources."
          disabled={levers.lowerTargetBy === 0}
        />
        <Lever
          label="Increase monthly inflow"
          value={`+${ccySym}${levers.increaseSurplusBy.toLocaleString()}/mo`}
          subtle="Without tapping EF / portfolio — surplus alone closes it."
          disabled={levers.increaseSurplusBy === 0}
        />
        {showsBothSurplusLevers && (
          <Lever
            label="…or, if you also tap lump sums"
            value={`+${ccySym}${levers.increaseSurplusByWithLumpSum.toLocaleString()}/mo`}
            subtle="EF + portfolio cover the rest; smaller monthly add."
            disabled={false}
          />
        )}
      </div>
      <BumpPriorityRow
        gain={levers.bumpPriorityGain}
        closesGap={levers.bumpPriorityClosesGap}
        priorityBump={priorityBump}
        deadlineKind={deadlineKind}
        ccySym={ccySym}
        onBump={onBumpPriority}
      />
      <CommitExpenseCutRow
        monthlyDelta={levers.increaseSurplusBy}
        totalExpenses={totalExpenses}
        ccySym={ccySym}
        onCommit={onCommitExpenseCut}
      />
    </div>
  );
}

/**
 * Bump-priority CTA shown inside the shortfall panel. Hidden when:
 *   • this goal is already bumped (no further upside),
 *   • there are no higher-priority goals draining surplus (`gain ≤ 0`),
 *   • or the gain is trivial (<1 user-currency unit) — e.g. all priors
 *     have already expired.
 *
 * Rendered most prominently when the deadline is hard AND bumping
 * alone closes the gap — that's the only single-click fix when the
 * extend-date lever has been hidden.
 */
function BumpPriorityRow({
  gain,
  closesGap,
  priorityBump,
  deadlineKind,
  ccySym,
  onBump,
}: {
  gain: number;
  closesGap: boolean;
  priorityBump: boolean;
  deadlineKind: 'hard' | 'soft';
  ccySym: string;
  onBump: () => void;
}) {
  if (priorityBump) return null;
  if (gain <= 0) return null;
  const isHardAndCloses = deadlineKind === 'hard' && closesGap;
  const accent = isHardAndCloses ? 'var(--positive)' : 'var(--accent)';
  const headline = closesGap
    ? `Bumping priority would unlock ${ccySym}${gain.toLocaleString()} of surplus currently routed to earlier goals — enough to close this shortfall.`
    : `Bumping priority would route ${ccySym}${gain.toLocaleString()} of surplus to this goal first instead of earlier-dated ones. Helps, but won't close the gap alone.`;
  return (
    <div
      style={{
        marginTop: 8,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 10,
        padding: '6px 10px',
        background: 'var(--soft-bg)',
        borderLeft: `3px solid ${accent}`,
        borderRadius: 4,
        fontSize: 12,
        color: 'var(--muted)',
        lineHeight: 1.45,
      }}
    >
      <span>{headline}</span>
      <button
        type="button"
        onClick={onBump}
        style={{
          flexShrink: 0,
          padding: '5px 12px',
          border: `1px solid ${accent}`,
          background: 'var(--canvas)',
          color: 'var(--ink)',
          borderRadius: 4,
          cursor: 'pointer',
          fontSize: 12,
          fontWeight: 600,
        }}
      >
        Bump priority
      </button>
    </div>
  );
}

/**
 * Companion to the "Increase monthly inflow" lever: lets the user
 * actually *commit* to the cut from this surface, without bouncing
 * out to a separate budget editor. The mutation lands on the profile
 * + writes a decision-log entry (visible later in the activity
 * ledger). Hidden when there's no shortfall to close or when total
 * monthly expenses are too low to absorb the cut (heuristic: leave
 * at least 30% of current spend untouched so we don't suggest a cut
 * that's effectively impossible).
 */
/**
 * Funding-schedule panel — shows the auto-computed defer suggestion
 * for the goal and an "Start saving now" override link.
 *
 * Default behavior: app auto-defers funding until the latest month
 * that still hits the deadline, so debt prepay gets the full surplus
 * until then. Less total interest paid over the life of the debt.
 *
 * User can override: clicking "Start saving now" sets
 * `autoDefer=false` + `fundingStartMonth=undefined` — engine routes
 * to this goal from month 0 onward, the panel stops auto-recomputing.
 */
function FundingSchedulePanel({
  goal,
  ccySym,
  months,
  required,
  savedSoFar,
  monthlySurplus,
  priorGoalsMonthlyDraw,
  deferSuggestion,
  onUseAutoDefer,
  onStartNow,
}: {
  goal: Goal;
  ccySym: string;
  months: number;
  required: number;
  savedSoFar: number;
  /** Total monthly surplus this user has. Used in override mode to
   *  detect when prior-goal draws + this goal's run-rate exceed
   *  available surplus, so we can warn the user honestly instead of
   *  quoting a rate the engine can't deliver. */
  monthlySurplus: number;
  /** Average monthly draw taken by higher-priority goals across this
   *  goal's window — see `priorDrawByGoal` in the parent. */
  priorGoalsMonthlyDraw: number;
  deferSuggestion: GoalDeferResult | null;
  onUseAutoDefer: () => void;
  onStartNow: () => void;
}) {
  if (required <= 0) return null;
  if (required <= savedSoFar) return null;
  // Past-date goals: the target month already happened (months <= 0).
  // Don't render the "saving starts [date]" narrative — it's
  // misleading. Instead surface a clear past-date state so the user
  // either updates the date or removes the goal.
  if (months <= 0) {
    return (
      <div
        style={{
          padding: '10px 12px',
          border: '1px solid var(--warning)',
          background: 'var(--soft-bg)',
          borderRadius: 6,
          fontSize: 13,
          color: 'var(--warning)',
        }}
      >
        <div style={{ fontWeight: 600, marginBottom: 2 }}>
          Target date has passed
        </div>
        <div style={{ color: 'var(--muted)', fontSize: 12 }}>
          {ccySym}
          {Math.round(required - savedSoFar).toLocaleString()} still needed.
          Update the target month above to plan funding, or remove this goal
          if it&apos;s no longer relevant.
        </div>
      </div>
    );
  }

  const autoDeferOn = goal.autoDefer !== false;
  const startMonthLabel = goal.fundingStartMonth
    ? prettyMonth(goal.fundingStartMonth)
    : null;
  const activeMonths = deferSuggestion
    ? Math.max(1, months - deferSuggestion.startMonthIndex)
    : months;
  const fundingRate = deferSuggestion?.fundingMonthlyRate ?? 0;

  // Two narratives:
  //   • Auto-defer applied (default): "Saving from [Month] – ₹X/mo for Y months."
  //     Override link offered, not pushed.
  //   • User has overridden: "Saving now – ₹X/mo for Y months." Hint to re-enable.
  if (autoDeferOn && deferSuggestion && deferSuggestion.startMonthIndex > 0) {
    return (
      <div
        style={{
          padding: '10px 12px',
          border: '1px solid var(--border)',
          background: 'var(--soft-bg)',
          borderRadius: 6,
          fontSize: 13,
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          justifyContent: 'space-between',
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, marginBottom: 2 }}>
            Saving starts {startMonthLabel ?? '—'} · {ccySym}
            {Math.round(fundingRate).toLocaleString()}/mo for {activeMonths} months
          </div>
          <div style={{ color: 'var(--muted)', fontSize: 12 }}>
            All surplus flows to debt prepay until then — less total interest
            on the way. <InfoTip>{deferRationale(deferSuggestion, months, ccySym, required)}</InfoTip>
          </div>
        </div>
        <button
          type="button"
          onClick={onStartNow}
          style={{
            padding: '6px 10px',
            border: '1px solid var(--border)',
            background: 'transparent',
            color: 'var(--accent)',
            borderRadius: 4,
            fontSize: 12,
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          Start saving now anyway
        </button>
      </div>
    );
  }

  // Override path — user has chosen to start saving immediately.
  if (!autoDeferOn) {
    // Target rate: what this goal asks for, spread across the window.
    const targetRate =
      months > 0 ? Math.max(0, (required - savedSoFar) / months) : 0;
    // Achievable rate: capped by the surplus that's actually free
    // after higher-priority goals take their share. When prior goals
    // claim more than the total surplus, this clamps to 0.
    const remainingSurplus = Math.max(0, monthlySurplus - priorGoalsMonthlyDraw);
    const deliverableRate = Math.min(targetRate, remainingSurplus);
    const isStrained = deliverableRate < targetRate - 1; // 1-unit tolerance for float math
    return (
      <div
        style={{
          padding: '10px 12px',
          border: '1px solid var(--border)',
          background: 'var(--soft-bg)',
          borderRadius: 6,
          fontSize: 13,
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          justifyContent: 'space-between',
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, marginBottom: 2 }}>
            Saving now · {ccySym}
            {Math.round(deliverableRate).toLocaleString()}/mo for {months} months
            {isStrained && (
              <span
                style={{ color: 'var(--warning)', fontWeight: 500, marginLeft: 6 }}
              >
                · short of the {ccySym}
                {Math.round(targetRate).toLocaleString()}/mo this goal needs
              </span>
            )}
          </div>
          <div style={{ color: 'var(--muted)', fontSize: 12 }}>
            {isStrained
              ? `Your remaining surplus after higher-priority goals is ${ccySym}${Math.round(remainingSurplus).toLocaleString()}/mo — see the shortfall levers below.`
              : "Surplus is split between this goal + debt every month. Auto-defer would push saving later to leave more surplus for debt prepay until then — switch back if you prefer."}
          </div>
        </div>
        <button
          type="button"
          onClick={onUseAutoDefer}
          style={{
            padding: '6px 10px',
            border: '1px solid var(--accent)',
            background: 'var(--accent)',
            color: 'var(--bg)',
            borderRadius: 4,
            fontSize: 12,
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          Use recommended timeline
        </button>
      </div>
    );
  }

  // No defer possible (full window needed) — silent. The goal is
  // already drawing every month it has; nothing to surface.
  return null;
}

function prettyMonth(yyyymm: string): string {
  if (!yyyymm || yyyymm.length < 7) return yyyymm;
  const [y, m] = yyyymm.split('-');
  const idx = Math.max(1, Math.min(12, Number(m)));
  const name = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ][idx - 1];
  return `${name} ${y}`;
}

function deferRationale(
  s: GoalDeferResult,
  totalMonths: number,
  ccySym: string,
  required: number,
): string {
  const evenPerMonth = totalMonths > 0 ? required / totalMonths : 0;
  const activeMonths = Math.max(1, totalMonths - s.startMonthIndex);
  return (
    `You need ${ccySym}${Math.round(required).toLocaleString()} in ${totalMonths} months. ` +
    `Splitting that evenly would mean ${ccySym}${Math.round(evenPerMonth).toLocaleString()}/mo to this goal for the whole window. ` +
    `Saving in the last ${activeMonths} months instead lets every ${ccySym}/mo go to debt prepay until then — ` +
    `your loan balance drops faster, so total interest paid over the life of the loan drops too.`
  );
}

function CommitExpenseCutRow({
  monthlyDelta,
  totalExpenses,
  ccySym,
  onCommit,
}: {
  monthlyDelta: number;
  totalExpenses: number;
  ccySym: string;
  onCommit: (monthlyDelta: number) => boolean;
}) {
  const [committed, setCommitted] = useState(false);
  if (monthlyDelta <= 0) return null;
  // Cap: don't propose cuts larger than 70% of current total expenses
  // — that's the "lifestyle pain" floor we agreed in the design pass.
  // Above that floor we render an honest "too steep" note instead of
  // suppressing the affordance entirely, so the user sees *why* the
  // commit-cut path isn't being offered for this gap and knows to look
  // at the other levers (cross-goal reorder, liquidate, new loan).
  const cuttable = totalExpenses > 0 && monthlyDelta <= totalExpenses * 0.7;
  if (!cuttable) {
    return (
      <div
        style={{
          marginTop: 8,
          padding: '6px 10px',
          background: 'var(--soft-bg)',
          borderLeft: '3px solid var(--muted)',
          fontSize: 12,
          color: 'var(--muted)',
          lineHeight: 1.45,
        }}
      >
        Cutting {ccySym}
        {Math.round(monthlyDelta).toLocaleString()}/mo would mean
        reducing your expenses by more than 70% — too steep to be
        sustainable. Look at the other levers below.
      </div>
    );
  }

  function handleClick() {
    const ok = window.confirm(
      `Commit to cutting ${ccySym}${Math.round(monthlyDelta).toLocaleString()}/mo from your expenses, starting next month?\n\nYour stored budget will update immediately. You can undo from the activity ledger anytime.`,
    );
    if (!ok) return;
    if (onCommit(monthlyDelta)) setCommitted(true);
  }

  if (committed) {
    return (
      <div
        style={{
          marginTop: 8,
          padding: '8px 10px',
          background: 'var(--soft-bg)',
          borderLeft: '3px solid var(--positive)',
          fontSize: 12,
          color: 'var(--ink)',
          lineHeight: 1.5,
        }}
      >
        <strong style={{ color: 'var(--positive)' }}>Committed.</strong>{' '}
        Expenses reduced by {ccySym}
        {Math.round(monthlyDelta).toLocaleString()}/mo. The ledger
        records this — you can reconcile or undo there.
      </div>
    );
  }
  return (
    <div
      style={{
        marginTop: 8,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 10,
        padding: '6px 10px',
        background: 'var(--soft-bg)',
        borderRadius: 4,
        fontSize: 12,
        color: 'var(--muted)',
        lineHeight: 1.45,
      }}
    >
      <span>
        Plan to cut {ccySym}
        {Math.round(monthlyDelta).toLocaleString()}/mo from expenses? Apply
        now and your plan will reflect the higher surplus from next month.
      </span>
      <button
        type="button"
        onClick={handleClick}
        style={{
          flexShrink: 0,
          padding: '5px 12px',
          border: '1px solid var(--ink)',
          background: 'var(--canvas)',
          color: 'var(--ink)',
          borderRadius: 4,
          cursor: 'pointer',
          fontSize: 12,
          fontWeight: 600,
        }}
      >
        Commit cut
      </button>
    </div>
  );
}

function Lever({
  label,
  value,
  subtle,
  disabled,
}: {
  label: string;
  value: string;
  subtle: string;
  disabled: boolean;
}) {
  return (
    <div
      style={{
        padding: 8,
        background: 'var(--soft-bg)',
        borderRadius: 4,
        opacity: disabled ? 0.55 : 1,
        lineHeight: 1.4,
      }}
    >
      <div style={{ fontSize: 10, color: 'var(--muted)', letterSpacing: '0.04em' }}>
        {label.toUpperCase()}
      </div>
      <div style={{ fontWeight: 600, marginTop: 2 }}>{value}</div>
      <div style={{ color: 'var(--muted)', fontSize: 11, marginTop: 2 }}>{subtle}</div>
    </div>
  );
}

/**
 * Headline "expected fill rate" badge on each goal card. Two flavours:
 *
 *   • If the user has saved-so-far on this goal (contributions logged)
 *     we show the actual progress (saved / required) — concrete, not
 *     a projection.
 *   • Otherwise we surface what the achievability check projects for
 *     T1 (surplus-only). That's an upper bound — the engine's
 *     per-goal allocation may share surplus with other goals, but
 *     this gives the user a first-pass read at goal-creation time.
 *
 * Tone:
 *   • positive (green) at ≥ 100%
 *   • warning (amber) at 70-99%
 *   • negative (red) below 70%
 */
function FillRateBadge({
  goal,
  today,
  required,
  savedSoFar,
  projectedFillRate,
  projectedFunded,
}: {
  goal: Goal;
  today: Date;
  required: number;
  savedSoFar: number;
  /** 0–1 fill rate the recommended tier projects for the target month.
   *  Includes both already-saved contributions and the forward
   *  contribution this tier delivers — so a 70%-saved goal with a
   *  smaller forward window still reads as ≥ 70%. */
  projectedFillRate: number;
  /** True when the recommended tier reaches required — the "funded"
   *  equivalent of the engine's GoalFinal.funded flag, computed
   *  locally from the same arithmetic that drives the lever panel. */
  projectedFunded: boolean;
}) {
  const months = monthsUntil(goal, today);
  if (required <= 0 || months <= 0) return null;
  const savedPct = Math.round((savedSoFar / required) * 100);
  const projPct = Math.round(projectedFillRate * 100);
  const hasSaved = savedSoFar > 0;
  // Tone driven by total reachable (saved + projection). Already
  // funded → green regardless of forward surplus. Short → red.
  // 70%+ but not closing the gap → warning.
  const tone = projectedFunded
    ? 'var(--positive)'
    : projPct >= 70
      ? 'var(--warning)'
      : 'var(--negative)';
  // Label combinations:
  //   • nothing saved → "X% projected by target"
  //   • saved == projected (no forward growth) → "X% saved"
  //   • saved < projected → "X% saved → Y% by target"
  //   • already funded by saved alone → "100% saved"
  let label: string;
  if (!hasSaved) {
    label = `${projPct}% projected by target`;
  } else if (projPct <= savedPct) {
    label = `${savedPct}% saved`;
  } else {
    label = `${savedPct}% saved → ${projPct}% by target`;
  }
  const projectedTotal = Math.round(projectedFillRate * required);
  const tooltip = hasSaved
    ? `Already saved ${savedSoFar.toLocaleString()} of ${required.toLocaleString()}. By the target month you're projected to have ${projectedTotal.toLocaleString()} (${projPct}%).`
    : `Projected ${projectedTotal.toLocaleString()} of ${required.toLocaleString()} by target month.`;
  return (
    <span
      style={{
        marginLeft: 8,
        padding: '1px 8px',
        fontSize: 11,
        fontWeight: 600,
        color: tone,
        border: `1px solid ${tone}`,
        borderRadius: 10,
      }}
      title={tooltip}
    >
      {label}
    </span>
  );
}
