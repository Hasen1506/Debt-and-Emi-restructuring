'use client';

/**
 * Surplus allocation waterfall — "where does my surplus go?" rendered
 * directly from the engine's first-month allocation snapshot.
 *
 * Layout:
 *
 *   Surplus ₹X
 *   ├── Goal A  ₹A (run-rate ₹A · X% expected fill)
 *   ├── Goal B  ₹B (queued — surplus exhausted)
 *   ├── EF top-up ₹E
 *   └── Highest-effective-APR debt ₹D
 *
 * Goals show in user-effective order: bumped first, then by target
 * date. Drag a goal to bump it (lifts above natural-date neighbours)
 * or to reorder within the bumped group. Persists `priorityBump` +
 * `orderIndex` and triggers a /plan refresh so the engine re-runs.
 */

import Decimal from 'decimal.js';
import { useRouter } from 'next/navigation';
import { formatCurrency, type LoanType } from '@/lib/api';
import { fmt } from '@/lib/effective-apr';
import { deriveMetrics } from '@/lib/derived';
import {
  readGoalsClient,
  writeGoalsClient,
  monthsUntil,
  type Goal,
} from '@/lib/goals';
import { allocateSurplus } from '@/lib/surplus-allocation';
import { InfoTip } from '@/components/ToolPrimitives';
import { useEffect, useState } from 'react';
import type { PlanData } from './PlanData';

const LOAN_TYPE_LABEL: Record<LoanType, string> = {
  credit_card: 'credit card',
  personal_loan: 'personal loan',
  home_loan: 'home loan',
  auto_loan: 'auto loan',
  education_loan: 'education loan',
  gold_loan: 'gold loan',
  bnpl: 'BNPL line',
};

const QUEUED_REASON_TEXT: Record<
  NonNullable<PlanData['goalContributions'][number]['queuedReason']>,
  string
> = {
  past_date: 'target date passed — reset on Goals',
  over_funded: 'already at target',
  surplus_exhausted: "no surplus left after earlier goals",
  partial_fill: 'partially funded — below run-rate',
  deferred: 'deferred — saving starts later',
};

/** Convert a 0-based sim-month offset into a short YYYY-MM calendar
 *  label for the queued-goals footer. Sim month 0 = current calendar
 *  month, so we add the offset to today's year/month and format. */
function simIndexToCalendarLabel(idx: number): string {
  const today = new Date();
  const d = new Date(today.getFullYear(), today.getMonth() + idx, 1);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[d.getMonth()]} ${d.getFullYear()}`;
}

export function SurplusWaterfall({ plan }: { plan: PlanData }) {
  const router = useRouter();
  const [goalsById, setGoalsById] = useState<Map<string, Goal>>(new Map());
  const [draggedId, setDraggedId] = useState<string | null>(null);

  useEffect(() => {
    const map = new Map<string, Goal>();
    for (const g of readGoalsClient()) map.set(g.id, g);
    setGoalsById(map);
  }, []);

  /**
   * Reorder a goal. `targetIndex` is the position in the rendered
   * waterfall sequence. The first N positions belong to bumped goals;
   * the rest are unbumped (date-ordered). Dropping into a bumped slot
   * sets priorityBump=true; dropping into an unbumped slot sets it
   * false. `orderIndex` is recomputed for the bumped group so within-
   * bumped sequence honours the drag.
   */
  function reorderGoal(sourceId: string, targetIndex: number) {
    const all = readGoalsClient();
    const source = all.find((g) => g.id === sourceId);
    if (!source) return;

    // Build current visible sequence (engine returned them in
    // user-effective order). We rebuild the goals list to match the
    // post-drop sequence.
    const seq = plan.goalContributions
      .map((c) => all.find((g) => g.id === c.goalId))
      .filter((g): g is Goal => !!g);
    const without = seq.filter((g) => g.id !== sourceId);
    const insertAt = Math.max(0, Math.min(targetIndex, without.length));

    // Bump inference: the source becomes bumped iff its drop position
    // is at or before the *existing* bumped-block boundary (i.e. before
    // the first unbumped goal in `without`). This makes the boundary
    // semantic explicit instead of circular: we don't ask "is the
    // source bumped → does that affect the boundary"; we measure the
    // boundary in the other rows first, then decide.
    const peerBumpedCount = leadingBumpedCount(without);
    const sourceBecomesBumped = insertAt <= peerBumpedCount;
    const bumpedCount = sourceBecomesBumped
      ? peerBumpedCount + 1
      : peerBumpedCount;

    without.splice(insertAt, 0, source);
    const next = without.map((g, idx) => ({
      ...g,
      priorityBump: idx < bumpedCount,
      orderIndex: idx < bumpedCount ? idx : undefined,
    }));
    // Preserve goals not in the rendered sequence (e.g. past-date /
    // over-funded ones the engine didn't return contributions for).
    const inSeq = new Set(next.map((g) => g.id));
    const others = all.filter((g) => !inSeq.has(g.id));
    writeGoalsClient([...next, ...others]);

    const newMap = new Map<string, Goal>();
    for (const g of [...next, ...others]) newMap.set(g.id, g);
    setGoalsById(newMap);
    setDraggedId(null);
    router.refresh();
  }

  const m = deriveMetrics({
    user: plan.user,
    marginalRate: plan.marginalRate,
    creditScore: null,
    isLive: plan.profileIsLive,
  });
  // The engine's figure, so the header is the total the slices add up to.
  const surplus = plan.surplusAllocation?.surplus ?? plan.surplus;
  const ccy = plan.displayCurrency;
  const efSplit = Number(plan.efSplit || '0');
  const efBalance = Number(plan.user.efund_balance || '0');
  const efTarget = Number(plan.user.efund_target || '0');
  const efGap = Math.max(0, efTarget - efBalance);

  if (surplus <= 0) {
    return (
      <div
        style={{
          padding: 14,
          background: 'var(--card)',
          border: '1px solid var(--negative)',
          borderRadius: 6,
          fontSize: 13,
          color: 'var(--negative)',
        }}
      >
        Surplus is {formatCurrency(surplus, ccy)}/mo — nothing to allocate.
        Review fixed expenses or scheduled EMIs first; the waterfall comes
        back when surplus turns positive.
      </div>
    );
  }

  const { goalSlice, efSlice, debtSlice } = plan.surplusAllocation ?? {
    ...allocateSurplus({
      surplus,
      efSplit,
      efGap,
      efPreempted: false,
    }),
  };

  const debtTarget = m.loudest;
  // Engine returned per-goal contributions are already in user-effective
  // order (bumped first, then by date). Split funded vs queued purely
  // by amount > 0 — fill-rate lives in plan.goalFinals (lookup by id).
  const fundedContributions = plan.goalContributions.filter((c) => c.amount > 0);
  const queuedContributions = plan.goalContributions.filter((c) => c.amount === 0);
  const fillRateById = new Map(
    plan.goalFinals.map((f) => [f.goalId, f.fillRate]),
  );
  // Companion map for "deadline beyond debt-free" — the queued-goals
  // footer renders an honest "deadline is past your debt-free month"
  // line instead of a misleading low projected-fill when this is set.
  const pastHorizonById = new Map(
    plan.goalFinals.map((f) => [f.goalId, f.targetPastHorizon]),
  );

  return (
    <div
      style={{
        padding: '14px 16px',
        background: 'var(--card)',
        border: '1px solid var(--border)',
        borderRadius: 6,
      }}
    >
      <div
        style={{
          fontSize: 11,
          color: 'var(--muted)',
          letterSpacing: '0.12em',
          marginBottom: 8,
          textTransform: 'uppercase',
        }}
      >
        This month&apos;s surplus allocation
      </div>
      <div
        style={{
          fontSize: 16,
          fontWeight: 600,
          marginBottom: 10,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
        }}
      >
        <span>Surplus</span>
        <InfoTip>
          Each month your take-home pay covers a few mandatory things —
          rent, food, bills, and minimum loan payments. Whatever&apos;s left
          is your <strong>surplus</strong> — the money you actually decide
          what to do with. This card shows where it goes.
        </InfoTip>
        <span className="num" style={{ color: 'var(--positive)' }}>
          {formatCurrency(surplus, ccy)}/mo
        </span>
      </div>
      {fundedContributions.length > 1 && (
        <div
          style={{
            marginBottom: 8,
            fontSize: 11,
            color: 'var(--muted)',
            lineHeight: 1.4,
          }}
        >
          <strong style={{ color: 'var(--ink)' }}>Drag</strong> a goal up to
          bump its priority (it&apos;ll be funded ahead of earlier-dated
          goals).
        </div>
      )}
      <ul style={{ listStyle: 'none', padding: 0, margin: 0, fontSize: 13 }}>
        {fundedContributions.map((c, idx) => (
          <DraggableGoalRow
            key={c.goalId}
            index={idx}
            contribution={c}
            goal={goalsById.get(c.goalId)}
            ccy={ccy}
            fillRate={fillRateById.get(c.goalId)}
            isBeingDragged={draggedId === c.goalId}
            onDragStart={() => setDraggedId(c.goalId)}
            onDragEnd={() => setDraggedId(null)}
            onDropAt={(target) => reorderGoal(draggedId ?? c.goalId, target)}
          />
        ))}
        {efSlice > 0 && (
          <Row
            label="Emergency fund top-up"
            amount={efSlice}
            ccy={ccy}
            note={`${Math.round(efSplit * 100)}% of surplus; ${formatCurrency(efGap, ccy)} gap remaining.`}
            color="var(--positive)"
          />
        )}
        {debtSlice > 0 && (
          <Row
            label={
              debtTarget
                ? `${debtTarget.loan.bank || 'Highest-rate'} ${LOAN_TYPE_LABEL[debtTarget.loan.loan_type]}`
                : 'Debt slice'
            }
            amount={debtSlice}
            ccy={ccy}
            note={
              debtTarget
                ? `${fmt(debtTarget.effective)} effective — the avalanche target.`
                : 'No active debt — surplus banked.'
            }
            color="var(--ink)"
          />
        )}
        {/* Legacy single-goal fallback (no goal_finals from engine) */}
        {fundedContributions.length === 0 && goalSlice > 0 && (
          <Row
            label="Goal"
            amount={goalSlice}
            ccy={ccy}
            note="Active goal · EF + debt paused while the goal window is open."
            color="var(--accent)"
          />
        )}
      </ul>
      {plan.anyGoalShort && (
        <div
          style={{
            marginTop: 10,
            padding: '8px 10px',
            background: 'var(--card)',
            borderLeft: '3px solid var(--negative)',
            fontSize: 12,
            color: 'var(--ink)',
            lineHeight: 1.5,
          }}
        >
          <strong style={{ color: 'var(--negative)' }}>
            Some goals are short this month.
          </strong>{' '}
          Surplus ({formatCurrency(surplus, ccy)}/mo) doesn&apos;t fully cover
          every goal&apos;s run-rate. Drag a goal up to give it priority, or
          adjust the date/amount on the Goals page — each goal has its own
          shortfall levers.
        </div>
      )}
      {queuedContributions.length > 0 && (
        <QueuedGoalsFooter
          contributions={queuedContributions}
          goalsById={goalsById}
          fillRateById={fillRateById}
          pastHorizonById={pastHorizonById}
        />
      )}
    </div>
  );
}

/** Count of consecutive priorityBump goals at the start of a sequence. */
function leadingBumpedCount(goals: Goal[]): number {
  let n = 0;
  for (const g of goals) {
    if (!g.priorityBump) break;
    n += 1;
  }
  return n;
}

function QueuedGoalsFooter({
  contributions,
  goalsById,
  fillRateById,
  pastHorizonById,
}: {
  contributions: PlanData['goalContributions'];
  goalsById: Map<string, Goal>;
  fillRateById: Map<string, number>;
  pastHorizonById: Map<string, boolean>;
}) {
  return (
    <div
      style={{
        marginTop: 10,
        padding: '8px 10px',
        background: 'var(--canvas)',
        border: '1px dashed var(--border)',
        borderRadius: 4,
        fontSize: 11,
        color: 'var(--muted)',
        lineHeight: 1.5,
      }}
    >
      <strong style={{ color: 'var(--ink)' }}>
        {contributions.length} goal{contributions.length === 1 ? '' : 's'} not
        funded this month
      </strong>
      <ul style={{ listStyle: 'none', padding: 0, margin: '4px 0 0' }}>
        {contributions.slice(0, 4).map((c) => {
          const g = goalsById.get(c.goalId);
          const label = g?.label || g?.kind || c.goalId;
          const fill = fillRateById.get(c.goalId);
          const reasonText = c.queuedReason
            ? QUEUED_REASON_TEXT[c.queuedReason]
            : 'not funded this month';
          // For deferred rows, append "(starts <calendar month>)" so the
          // user sees when the ₹0 turns into real funding — closes the
          // honesty gap noted in the snapshot critique.
          const deferredStart =
            c.queuedReason === 'deferred' && c.fundingStartMonthIndex !== null
              ? ` (starts ${simIndexToCalendarLabel(c.fundingStartMonthIndex)})`
              : '';
          // Past-horizon: the sim went debt-free before this goal's
          // deadline. The user isn't behind — the projection just
          // stops short. Surface that honestly instead of a low
          // "projected fill %" that reads as failure.
          const pastHorizon = pastHorizonById.get(c.goalId) === true;
          return (
            <li key={c.goalId}>
              <span style={{ color: 'var(--ink)' }}>{label}</span> — {reasonText}
              {deferredStart}
              {pastHorizon ? (
                <span className="muted">
                  {' '}
                  · deadline is past your debt-free month — fund it
                  manually then
                </span>
              ) : (
                fill !== undefined && fill < 1 && (
                  <span className="muted">
                    {' '}
                    · projected fill {Math.round(fill * 100)}%
                  </span>
                )
              )}
            </li>
          );
        })}
        {contributions.length > 4 && (
          <li>+{contributions.length - 4} more</li>
        )}
      </ul>
    </div>
  );
}

function Row({
  label,
  amount,
  ccy,
  note,
  color,
}: {
  label: string;
  amount: number;
  ccy: string;
  note: string;
  color: string;
}) {
  return (
    <li
      style={{
        display: 'flex',
        alignItems: 'baseline',
        gap: 12,
        padding: '8px 0',
        borderTop: '1px dashed var(--border)',
      }}
    >
      <span style={{ minWidth: 100, color, fontWeight: 600 }} className="num">
        {formatCurrency(new Decimal(amount).toFixed(0), ccy as 'INR' | 'USD')}
      </span>
      <span style={{ flex: 1 }}>
        <div style={{ fontWeight: 600 }}>{label}</div>
        <div className="muted" style={{ fontSize: 12 }}>
          {note}
        </div>
      </span>
    </li>
  );
}

function DraggableGoalRow({
  index,
  contribution,
  goal,
  ccy,
  fillRate,
  isBeingDragged,
  onDragStart,
  onDragEnd,
  onDropAt,
}: {
  index: number;
  contribution: PlanData['goalContributions'][number];
  goal: Goal | undefined;
  ccy: 'INR' | 'USD';
  fillRate: number | undefined;
  isBeingDragged: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDropAt: (targetIndex: number) => void;
}) {
  const labelText = goal?.label || goal?.kind || 'Goal';
  const noteParts: string[] = [];
  if (goal) noteParts.push(`${monthsUntil(goal)} months`);
  if (contribution.runRate > 0) {
    noteParts.push(`run-rate ${formatCurrency(contribution.runRate, ccy)}/mo`);
  }
  if (fillRate !== undefined) {
    const pct = Math.round(fillRate * 100);
    noteParts.push(`projected fill ${pct}%`);
  }
  const isShort = contribution.amount < contribution.runRate - 1e-6;
  if (isShort) noteParts.push('(short)');
  return (
    <li
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move';
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
      }}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        // Drop above this row = take its index; below = next index.
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const above = e.clientY < rect.top + rect.height / 2;
        onDropAt(above ? index : index + 1);
      }}
      style={{
        display: 'flex',
        alignItems: 'baseline',
        gap: 12,
        padding: '8px 0 8px 4px',
        borderTop: '1px dashed var(--border)',
        cursor: 'grab',
        opacity: isBeingDragged ? 0.4 : 1,
        background:
          goal?.priorityBump ? 'rgba(0, 0, 0, 0.02)' : 'transparent',
      }}
    >
      <span
        aria-hidden
        style={{
          color: 'var(--muted)',
          cursor: 'grab',
          userSelect: 'none',
          fontSize: 14,
          lineHeight: 1,
          alignSelf: 'center',
        }}
        title="Drag to reorder"
      >
        ⋮⋮
      </span>
      <span
        style={{ minWidth: 96, color: 'var(--accent)', fontWeight: 600 }}
        className="num"
      >
        {formatCurrency(
          new Decimal(contribution.amount).toFixed(0),
          ccy as 'INR' | 'USD',
        )}
      </span>
      <span style={{ flex: 1 }}>
        <div style={{ fontWeight: 600 }}>
          Goal: {labelText}
          {goal?.priorityBump && (
            <span
              style={{
                marginLeft: 6,
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
        </div>
        <div className="muted" style={{ fontSize: 12 }}>
          {noteParts.join(' · ')}
        </div>
      </span>
    </li>
  );
}
