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
  fundedAmount,
  monthsUntil,
  readGoalsClient,
  writeGoalsClient,
} from '@/lib/goals';
import { analyseGoal, recommendedTier } from '@/lib/achievability';
import { readEfSplitClient } from '@/lib/ef-split';
import { readDecisionsClient, recordDecision } from '@/lib/decisions';
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

export function GoalsClient({ user, lowestRates }: Props) {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [efSplit, setEfSplit] = useState('0.3');
  const ccySym = user.country === 'IN' ? '₹' : '$';

  useEffect(() => {
    setGoals(readGoalsClient());
    setEfSplit(readEfSplitClient());
  }, []);

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

  // Sum of current_market_value across user-marked-liquid assets.
  // Pre-portfolio-advisor integration; the advisor returns a precise
  // optimal liquidation order. For the goal card we just need a ceiling.
  const liquidatableValue = (user.assets ?? [])
    .filter((a) => a.user_marks_liquid !== false)
    .reduce((s, a) => s + Number(a.current_market_value || '0'), 0);

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
          efSplit={Number(efSplit)}
          liquidatableValue={liquidatableValue}
          indicativeRate={indicativeRate}
          indicativeBank={lowestRates.personal?.bank ?? null}
          onPatch={(patch) => updateGoal(g.id, patch)}
          onToggleFunding={(src) => toggleFunding(g.id, src)}
          onRemove={() => removeGoal(g.id)}
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
  efSplit,
  liquidatableValue,
  indicativeRate,
  indicativeBank,
  onPatch,
  onToggleFunding,
  onRemove,
}: {
  goal: Goal;
  ccySym: string;
  monthlySurplus: number;
  efBalance: number;
  efTarget: number;
  efSplit: number;
  liquidatableValue: number;
  indicativeRate: number;
  indicativeBank: string | null;
  onPatch: (patch: Partial<Goal>) => void;
  onToggleFunding: (src: GoalFundingSource) => void;
  onRemove: () => void;
}) {
  const preset = GOAL_PRESETS[goal.kind];
  const months = monthsUntil(goal);
  const required = fundedAmount(goal);

  const tiers = analyseGoal({
    goal,
    monthlySurplus,
    efBalance,
    efTarget,
    efSplit,
    liquidatableValue,
    newLoanIndicativeRate: indicativeRate,
  });
  const rec = recommendedTier(tiers);

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
        <Select
          label="Priority"
          value={goal.priority}
          onChange={(v) => onPatch({ priority: v as 'critical' | 'standard' })}
          options={[
            { value: 'standard', label: 'Standard' },
            { value: 'critical', label: 'Critical' },
          ]}
          info={
            <>
              <strong>Critical</strong> goals pre-empt the EF waterfall and
              get prioritised when multiple goals contend for the same
              month&apos;s surplus. <strong>Standard</strong> goals share
              the surplus pool fairly.
            </>
          }
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
            checked={goal.preemptsEf}
            onChange={(e) => onPatch({ preemptsEf: e.target.checked })}
          />
          This goal pre-empts EF top-up
          <InfoTip>
            When checked, the EF / debt split slider on /plan is overridden
            for this goal&apos;s funding window. 100% of surplus routes to
            the goal instead of 30% being siphoned to EF. Use for high-
            stakes, fixed-date goals (wedding, medical) where you&apos;d
            rather rebuild EF after.
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

      <Achievability
        tiers={tiers}
        rec={rec}
        ccySym={ccySym}
        indicativeBank={indicativeBank}
        required={required}
        goalAmount={goal.amount}
      />
    </section>
  );
}

function Achievability({
  tiers,
  rec,
  ccySym,
  indicativeBank,
  required,
  goalAmount,
}: {
  tiers: ReturnType<typeof analyseGoal>;
  rec: ReturnType<typeof recommendedTier>;
  ccySym: string;
  indicativeBank: string | null;
  required: number;
  goalAmount: string;
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
