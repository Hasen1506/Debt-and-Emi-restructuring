'use client';

/**
 * Goals page client — list, edit, and run achievability checks on
 * user-defined goals. Surfaces all three tiers per goal so the user
 * can pick how they want to fund it before committing.
 *
 * Persistence: client-side localStorage via `goals.ts`. Server
 * re-hydration will land with auth.
 */

import { useEffect, useMemo, useState } from 'react';
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
  recommendedTier,
  type ShortfallLevers,
} from '@/lib/achievability';
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

  /**
   * Per-goal "draw from prior serial-fill claimants" — the sum of
   * monthly run-rates for every goal that ranks ahead of this one in
   * the engine's allocator order. Lets each GoalCard's achievability
   * check ask "what's the surplus I'd actually see, after my higher-
   * priority siblings have taken their slice?". Without this, T1
   * over-promises any non-leading goal because the engine's serial
   * fill drains earlier goals first.
   */
  const priorDrawByGoal = useMemo(() => {
    const sorted = [...goals].sort(compareGoalsForOrder);
    const draw: Record<string, number> = {};
    let cum = 0;
    for (const g of sorted) {
      draw[g.id] = cum;
      const months = monthsUntil(g);
      if (months <= 0) continue;
      const required = fundedAmount(g);
      const saved = savedByGoal[g.id] ?? 0;
      const remaining = Math.max(0, required - saved);
      if (remaining <= 0) continue;
      cum += remaining / months;
    }
    return draw;
  }, [goals, savedByGoal]);

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

  const efBalance = Number(user.efund_balance || '0');
  const efTarget = Number(user.efund_target || '0');

  // Liquid assets are passed to the card; per-goal we compound forward
  // by months_until_target so T3 reflects what the portfolio will be
  // worth on the goal's due-date, not today. Per-asset CAGR override
  // is honoured; otherwise country/asset-type defaults from
  // [[lib/asset-returns]] kick in.
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
    <main style={{ maxWidth: 980, margin: '24px auto', padding: '0 16px' }}>
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
          ccySym={ccySym}
          monthlySurplus={surplus}
          efBalance={efBalance}
          efTarget={efTarget}
          liquidatableValue={projectedLiquidatableValue(
            liquidAssets,
            user.country,
            monthsUntil(g),
          )}
          indicativeRate={indicativeRate}
          indicativeBank={lowestRates.personal?.bank ?? null}
          savedSoFar={savedByGoal[g.id] ?? 0}
          priorGoalsMonthlyDraw={priorDrawByGoal[g.id] ?? 0}
          contributions={contributions.filter((c) => c.goalId === g.id)}
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
    </main>
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
  ccySym,
  monthlySurplus,
  efBalance,
  efTarget,
  liquidatableValue,
  indicativeRate,
  indicativeBank,
  savedSoFar,
  priorGoalsMonthlyDraw,
  contributions,
  onPatch,
  onToggleFunding,
  onRemove,
  onLogContribution,
  onUnlogContribution,
  totalExpenses,
  onCommitExpenseCut,
}: {
  goal: Goal;
  ccySym: string;
  monthlySurplus: number;
  efBalance: number;
  efTarget: number;
  liquidatableValue: number;
  indicativeRate: number;
  indicativeBank: string | null;
  savedSoFar: number;
  priorGoalsMonthlyDraw: number;
  contributions: GoalContributionEntry[];
  onPatch: (patch: Partial<Goal>) => void;
  onToggleFunding: (src: GoalFundingSource) => void;
  onRemove: () => void;
  onLogContribution: (amount: string, date: string, source?: string) => void;
  onUnlogContribution: (id: string) => void;
  totalExpenses: number;
  onCommitExpenseCut: (monthlyDelta: number) => boolean;
}) {
  const preset = GOAL_PRESETS[goal.kind];
  const months = monthsUntil(goal);
  const required = fundedAmount(goal);

  const achievabilityInput = {
    goal,
    monthlySurplus,
    efBalance,
    efTarget,
    priorGoalsMonthlyDraw,
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
          <FillRateBadge goal={goal} required={required} savedSoFar={savedSoFar} />
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
        <Field
          label="Target month (YYYY-MM)"
          value={goal.targetMonth}
          onChange={(v) => onPatch({ targetMonth: v })}
          hint={`${months} months from now`}
        />
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
        ccySym={ccySym}
        indicativeBank={indicativeBank}
        required={required}
        goalAmount={goal.amount}
        totalExpenses={totalExpenses}
        onCommitExpenseCut={onCommitExpenseCut}
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
  ccySym,
  indicativeBank,
  required,
  goalAmount,
  totalExpenses,
  onCommitExpenseCut,
}: {
  tiers: ReturnType<typeof analyseGoal>;
  rec: ReturnType<typeof recommendedTier>;
  levers: ShortfallLevers | null;
  ccySym: string;
  indicativeBank: string | null;
  required: number;
  goalAmount: string;
  totalExpenses: number;
  onCommitExpenseCut: (monthlyDelta: number) => boolean;
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
          ccySym={ccySym}
          totalExpenses={totalExpenses}
          onCommitExpenseCut={onCommitExpenseCut}
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
  ccySym,
  totalExpenses,
  onCommitExpenseCut,
}: {
  levers: ShortfallLevers;
  ccySym: string;
  totalExpenses: number;
  onCommitExpenseCut: (monthlyDelta: number) => boolean;
}) {
  // If no lever offers a path forward, fall back to a single line so
  // we don't render a panel of three "n/a" cells.
  const hasAnyPath =
    (levers.extendMonthsBy != null && levers.extendMonthsBy > 0) ||
    levers.lowerTargetBy > 0 ||
    levers.increaseSurplusBy > 0;
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
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 8,
          fontSize: 12,
        }}
      >
        <Lever
          label="Push the date out"
          value={
            levers.extendMonthsBy != null
              ? `+${levers.extendMonthsBy} months`
              : 'not enough inflow'
          }
          subtle={
            levers.extendMonthsBy != null
              ? 'Same target, same surplus — later finish.'
              : 'Need additional inflow to ever close.'
          }
          disabled={levers.extendMonthsBy == null}
        />
        <Lever
          label="Lower the target"
          value={`-${ccySym}${levers.lowerTargetBy.toLocaleString()}`}
          subtle="Trim scope to fit the current date + surplus."
          disabled={levers.lowerTargetBy === 0}
        />
        <Lever
          label="Increase monthly inflow"
          value={`+${ccySym}${levers.increaseSurplusBy.toLocaleString()}/mo`}
          subtle="Same date, same target — needs higher surplus."
          disabled={levers.increaseSurplusBy === 0}
        />
      </div>
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
 * Companion to the "Increase monthly inflow" lever: lets the user
 * actually *commit* to the cut from this surface, without bouncing
 * out to a separate budget editor. The mutation lands on the profile
 * + writes a decision-log entry (visible later in the activity
 * ledger). Hidden when there's no shortfall to close or when total
 * monthly expenses are too low to absorb the cut (heuristic: leave
 * at least 30% of current spend untouched so we don't suggest a cut
 * that's effectively impossible).
 */
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
  // Below that floor we suppress the affordance entirely so the user
  // doesn't end up acting on a suggestion they can't realistically
  // sustain. Caller's next rung (cross-goal, liquidate, loan) picks up.
  const cuttable = totalExpenses > 0 && monthlyDelta <= totalExpenses * 0.7;
  if (!cuttable) return null;

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
  required,
  savedSoFar,
}: {
  goal: Goal;
  required: number;
  savedSoFar: number;
}) {
  const months = monthsUntil(goal);
  if (required <= 0 || months <= 0) return null;
  // Concrete progress if the user has logged contributions; else a
  // surplus-only projection capped at 100%.
  const pct = Math.round((savedSoFar / required) * 100);
  if (savedSoFar <= 0) return null;
  const tone =
    pct >= 100
      ? 'var(--positive)'
      : pct >= 70
        ? 'var(--warning)'
        : 'var(--negative)';
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
      title={`Saved ${savedSoFar.toLocaleString()} of ${required.toLocaleString()}`}
    >
      {pct}% saved
    </span>
  );
}
