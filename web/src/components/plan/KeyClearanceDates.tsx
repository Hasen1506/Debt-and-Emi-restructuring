'use client';

/**
 * Key clearance dates — replaces the wall-of-rows monthly schedule with
 * a milestone-first view. Headlines = the months that *matter* (each
 * loan's payoff, debt-free month, each active goal's target, retirement
 * age), each expandable into the per-month detail leading up to it.
 *
 * Why: a 100-year horizon (1200 months) makes a flat table useless. Users
 * care about *when* — the dates — and only zoom into the month-by-month
 * when verifying a specific one. This is the same affordance every
 * financial planning app converges on once users stop scrolling.
 *
 * Data sources:
 *   • plan.trajectory  — per-month balance + payments (for the expand)
 *   • plan.user.loans  — per-loan clear-month (computed from trajectory)
 *   • localStorage `finoptima_goals` — active goal targets (client-side)
 *   • plan.user.retirement_target_age — when set
 */

import { useEffect, useMemo, useState } from 'react';
import Decimal from 'decimal.js';
import { formatCurrency, type LoanType } from '@/lib/api';
import { monthIndexToCountryLabel } from '@/lib/today';
import { readGoalsClient, type Goal, monthsUntil } from '@/lib/goals';
import type { PlanData } from './PlanData';

interface Milestone {
  /** 1-based sim month at which the milestone fires. */
  month: number;
  /** Headline shown collapsed. */
  label: string;
  /** Sub-line under the headline. */
  detail: string;
  /** Origin → drives the chip color. */
  kind: 'loan_clear' | 'debt_free' | 'goal';
}

const LOAN_TYPE_SHORT: Record<LoanType, string> = {
  credit_card: 'Credit card',
  personal_loan: 'Personal loan',
  home_loan: 'Home loan',
  auto_loan: 'Auto loan',
  education_loan: 'Education loan',
  gold_loan: 'Gold loan',
  bnpl: 'BNPL',
};

function findLoanClearMonth(
  plan: PlanData,
  loanIndex: number,
): number | null {
  // A loan clears in the first month where its balance hits 0 and stays 0.
  // We walk the trajectory and check `balancesByLoanIndex`. Mock data won't
  // have these breakouts, so we conservatively return null when missing.
  let lastNonZero = 0;
  for (const p of plan.trajectory) {
    const v = Number(p.balancesByLoanIndex?.[loanIndex] ?? 0);
    if (v > 0) lastNonZero = p.month;
  }
  if (lastNonZero === 0) return null;
  // The clear month is the month immediately after lastNonZero — but only
  // when the trajectory continues past it. Otherwise the loan is still open.
  const lastMonth = plan.trajectory[plan.trajectory.length - 1]?.month ?? 0;
  if (lastNonZero >= lastMonth) return null;
  return lastNonZero + 1;
}

export function KeyClearanceDates({ plan }: { plan: PlanData }) {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    setGoals(readGoalsClient());
  }, []);

  const milestones = useMemo<Milestone[]>(() => {
    const out: Milestone[] = [];
    const ccy = plan.displayCurrency;

    plan.user.loans.forEach((l, i) => {
      const clearM = findLoanClearMonth(plan, i);
      if (!clearM) return;
      out.push({
        month: clearM,
        label: `${LOAN_TYPE_SHORT[l.loan_type] ?? l.loan_type} — ${l.bank} clears`,
        detail: `${formatCurrency(l.outstanding, ccy)} → 0`,
        kind: 'loan_clear',
      });
    });

    if (plan.debtFreeMonth) {
      out.push({
        month: plan.debtFreeMonth,
        label: 'Debt-free',
        detail: 'every loan at zero on the avalanche schedule',
        kind: 'debt_free',
      });
    }

    goals.forEach((g) => {
      const m = monthsUntil(g);
      if (m <= 0) return;
      out.push({
        // monthsUntil counts from this month; plan months start at 1.
        month: m + 1,
        label: g.label || `Goal: ${g.kind}`,
        detail: g.amount
          ? `target ${formatCurrency(g.amount, ccy)}`
          : 'target month',
        kind: 'goal',
      });
    });

    return out.sort((a, b) => a.month - b.month);
  }, [plan, goals]);

  if (milestones.length === 0) {
    return (
      <div
        style={{
          padding: 18,
          border: '1px dashed var(--border)',
          borderRadius: 8,
          color: 'var(--muted)',
          textAlign: 'center',
        }}
      >
        No milestones yet — add a goal or set a retirement age in onboarding
        to populate this view.
      </div>
    );
  }

  return (
    <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
      {milestones.map((m) => {
        const key = `${m.kind}-${m.month}-${m.label}`;
        const isOpen = expanded === key;
        return (
          <li
            key={key}
            style={{
              borderTop: '1px solid var(--border)',
              padding: '10px 0',
            }}
          >
            <button
              type="button"
              onClick={() => setExpanded(isOpen ? null : key)}
              style={{
                display: 'flex',
                width: '100%',
                background: 'transparent',
                border: 'none',
                padding: 0,
                cursor: 'pointer',
                alignItems: 'baseline',
                gap: 12,
                color: 'var(--ink)',
                textAlign: 'left',
              }}
            >
              <span
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  minWidth: 100,
                  color: colorFor(m.kind),
                }}
              >
                {monthIndexToCountryLabel(m.month, plan.user.country)}
              </span>
              <span style={{ flex: 1 }}>
                <span style={{ fontWeight: 600 }}>{m.label}</span>
                <span className="muted" style={{ marginLeft: 8, fontSize: 12 }}>
                  {m.detail}
                </span>
              </span>
              <span style={{ color: 'var(--muted)', fontSize: 12 }}>
                {isOpen ? '▾' : '▸'}
              </span>
            </button>
            {isOpen && <MonthDetail plan={plan} milestone={m} />}
          </li>
        );
      })}
    </ul>
  );
}

function colorFor(kind: Milestone['kind']): string {
  switch (kind) {
    case 'debt_free':
      return 'var(--positive)';
    case 'loan_clear':
      return 'var(--accent)';
    case 'goal':
      return 'var(--ink)';
  }
}

function MonthDetail({ plan, milestone }: { plan: PlanData; milestone: Milestone }) {
  // Window scales with milestone distance: 6 months works for a 12-month
  // payoff (full half), but for a 240-month payoff 6 months is noise. Use
  // the last ~10% of months leading up, clamped to [6, 18] so the table
  // stays scannable. Keeps the "what's the momentum just before this"
  // question answerable at any horizon.
  const windowMonths = Math.min(
    18,
    Math.max(6, Math.ceil(milestone.month * 0.1)),
  );
  const tail = plan.trajectory.filter(
    (p) =>
      p.month <= milestone.month && p.month > milestone.month - windowMonths,
  );
  if (tail.length === 0) {
    return (
      <div className="muted" style={{ fontSize: 12, padding: '8px 0 4px' }}>
        Trajectory data not available for this window.
      </div>
    );
  }
  return (
    <div
      style={{
        marginTop: 8,
        background: 'var(--card)',
        border: '1px solid var(--border)',
        borderRadius: 4,
        padding: 10,
        fontSize: 12,
      }}
    >
      <div className="muted" style={{ fontSize: 11, marginBottom: 6 }}>
        Last {tail.length} months on the avalanche schedule:
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ color: 'var(--muted)' }}>
            <th style={{ textAlign: 'left', padding: '2px 4px' }}>Month</th>
            <th style={{ textAlign: 'right', padding: '2px 4px' }}>Balance</th>
            <th style={{ textAlign: 'right', padding: '2px 4px' }}>vs minimums</th>
          </tr>
        </thead>
        <tbody>
          {tail.map((p) => (
            <tr key={p.month}>
              <td style={{ padding: '2px 4px' }}>
                {monthIndexToCountryLabel(p.month, plan.user.country)}
              </td>
              <td style={{ padding: '2px 4px', textAlign: 'right' }}>
                {formatCurrency(
                  new Decimal(p.avalanche || 0).toFixed(0),
                  plan.displayCurrency,
                )}
              </td>
              <td
                style={{
                  padding: '2px 4px',
                  textAlign: 'right',
                  color: p.avalanche < p.minimums ? 'var(--positive)' : 'var(--muted)',
                }}
              >
                {formatCurrency(
                  new Decimal(p.minimums || 0).toFixed(0),
                  plan.displayCurrency,
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
