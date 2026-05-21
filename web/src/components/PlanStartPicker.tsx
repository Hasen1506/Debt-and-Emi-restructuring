'use client';

/**
 * Lets the user choose when month 1 of the plan begins. Default is
 * "today" (current calendar month); the picker offers the next ~6
 * months so the user can defer the start without typing dates.
 *
 * Why surface this: the engine anchors annual-hike timing on
 * simulation_start_month. If the user is actually planning to start
 * "from next month" or "from April when FY rolls over," picking the
 * right anchor month aligns the projection with reality. Without it,
 * the hike fires at the wrong calendar boundary.
 */

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { writePlanStartClient } from '@/lib/plan-start';
import { readDecisionsClient, recordDecision } from '@/lib/decisions';
import { InfoTip } from '@/components/ToolPrimitives';

function monthLabel(yyyymm: string): string {
  const y = yyyymm.slice(0, 4);
  const m = Number(yyyymm.slice(5, 7));
  const monthNames = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];
  return `${monthNames[m - 1]} ${y}`;
}

function buildOptions(): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = [
    { value: '', label: 'Today' },
  ];
  const today = new Date();
  for (let i = 1; i <= 6; i += 1) {
    const d = new Date(today.getFullYear(), today.getMonth() + i, 1);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const value = `${yyyy}-${mm}`;
    out.push({ value, label: monthLabel(value) });
  }
  return out;
}

export function PlanStartPicker({
  active,
  variant = 'inline',
}: {
  active: string;
  variant?: 'inline' | 'ledger';
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const options = buildOptions();

  function pick(v: string) {
    if (v === active || pending) return;
    writePlanStartClient(v);
    recordDecision(readDecisionsClient(), {
      kind: 'plan_start_change',
      label: `Set plan start to ${v || 'today'}`,
      snapshot: { planStart: active },
      result: { planStart: v },
      impactDeltaMonths: null,
    });
    startTransition(() => router.refresh());
  }

  const explainer = (
    <InfoTip>
      <strong>What this changes.</strong> The simulation's month 1 anchors
      to whichever month you pick. Choose &quot;Today&quot; if you&apos;re
      starting now; pick a future month if you&apos;re budgeting from
      then (e.g. start of FY in April, or right after a planned salary
      change).
      <div style={{ marginTop: 8 }}>
        Picking a future month doesn&apos;t delay anything — it shifts
        the calendar alignment so annual hikes, advance-tax dates, and
        FX drift line up with that month&apos;s reality instead of
        today&apos;s.
      </div>
    </InfoTip>
  );

  if (variant === 'ledger') {
    return (
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 8,
          fontFamily: 'var(--font-mono)',
          fontSize: 11,
          letterSpacing: '0.08em',
          color: 'var(--muted)',
        }}
      >
        <span>PLAN START {explainer}</span>
        <select
          value={active}
          onChange={(e) => pick(e.target.value)}
          disabled={pending}
          style={{
            background: 'transparent',
            color: 'var(--ink)',
            border: '1px solid var(--border)',
            padding: '2px 6px',
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
          }}
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        {pending && <span>recomputing…</span>}
      </div>
    );
  }

  return (
    <div style={{ display: 'inline-flex', flexDirection: 'column', gap: 6, fontSize: 12 }}>
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontWeight: 600, fontSize: 13 }}>
          Plan start {explainer}
        </span>
        <select
          value={active}
          onChange={(e) => pick(e.target.value)}
          disabled={pending}
          style={{
            padding: '6px 10px',
            fontSize: 13,
            border: '1px solid var(--border)',
            borderRadius: 6,
            background: 'var(--card)',
            color: 'var(--ink)',
          }}
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
      <span className="muted" style={{ fontSize: 12, lineHeight: 1.5, maxWidth: 480 }}>
        {pending
          ? 'Recomputing schedule…'
          : active === ''
            ? 'Month 1 = current calendar month.'
            : `Month 1 = ${monthLabel(active)}.`}
      </span>
    </div>
  );
}
