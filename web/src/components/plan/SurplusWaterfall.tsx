'use client';

/**
 * Surplus allocation waterfall — the missing "where does my surplus go?"
 * answer that used to live implicitly in the engine. Renders this month's
 * cash flow:
 *
 *   Surplus ₹X
 *   ├── ₹A → EF top-up (Y% to fill the gap)
 *   ├── ₹B → Goal funding (when an active preempting goal is open)
 *   └── ₹C → Highest-effective-APR debt (loan name + rate)
 *
 * Pure UI; the engine already returns the pieces — we just expose them
 * so the user can see the allocation tree instead of guessing.
 */

import Decimal from 'decimal.js';
import { formatCurrency, type LoanType } from '@/lib/api';
import { fmt } from '@/lib/effective-apr';
import { deriveMetrics } from '@/lib/derived';
import { readGoalsClient, monthsUntil } from '@/lib/goals';
import { allocateSurplus } from '@/lib/surplus-allocation';
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

export function SurplusWaterfall({ plan }: { plan: PlanData }) {
  const [goalHeadline, setGoalHeadline] = useState<string | null>(null);

  useEffect(() => {
    const goals = readGoalsClient();
    const preempting = goals.find((g) => g.preemptsEf && monthsUntil(g) > 0);
    if (preempting) {
      setGoalHeadline(preempting.label || preempting.kind);
    }
  }, []);

  const m = deriveMetrics({
    user: plan.user,
    marginalRate: plan.marginalRate,
    creditScore: null,
    isLive: plan.profileIsLive,
  });
  const surplus = plan.surplus;
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

  const { goalSlice, efSlice, debtSlice } = allocateSurplus({
    surplus,
    efSplit,
    efGap,
    efPreempted: plan.efPreempted,
  });

  const debtTarget = m.loudest;

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
      <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 10 }}>
        Surplus{' '}
        <span className="num" style={{ color: 'var(--positive)' }}>
          {formatCurrency(surplus, ccy)}/mo
        </span>
      </div>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0, fontSize: 13 }}>
        {goalSlice > 0 && (
          <Row
            label={`Goal: ${goalHeadline ?? 'active'}`}
            amount={goalSlice}
            ccy={ccy}
            note="EF + debt paused while the goal window is open."
            color="var(--accent)"
          />
        )}
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
