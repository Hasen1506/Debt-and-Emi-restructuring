'use client';

/**
 * Inline chip strip showing which modeling assumptions are currently
 * baked into the /plan chart and KPIs. Sits above the total-balance
 * chart so the user can see "what produced this number" at a glance —
 * a remedy for the "7-toggle silent variability" problem.
 *
 * Each chip is a passive label, not a control. The actual toggles
 * live elsewhere on the page; this just summarises their state.
 */

import { STRATEGY_LABEL } from '@/lib/strategy';
import { InfoTip } from '@/components/ToolPrimitives';
import type { PlanData } from './PlanData';

export function AssumptionBadges({ plan }: { plan: PlanData }) {
  const chips: { label: string; tone?: 'default' | 'on' }[] = [];
  chips.push({ label: STRATEGY_LABEL[plan.strategy] });

  if (plan.hikeModeling === 'on') {
    const rate = Number(plan.user.annual_hike_rate || 0);
    chips.push({
      label: rate > 0 ? `+${(rate * 100).toFixed(0)}% hike/yr` : 'Hike on',
      tone: 'on',
    });
  }
  if (plan.inflationModeling === 'on') {
    const rate = Number(plan.user.inflation_rate || 0);
    chips.push({
      label: rate > 0 ? `${(rate * 100).toFixed(1)}% inflation` : 'Inflation on',
      tone: 'on',
    });
  }
  if (plan.fxDrift === 'on') chips.push({ label: 'FX drift on', tone: 'on' });
  if (plan.taxReinvest === 'on') {
    chips.push({ label: 'Tax-saving reinvest', tone: 'on' });
  }

  // EF waterfall — fires when there's an EF gap. Slider controls the %.
  // Goal pre-empt forces it to 0 silently; chip surfaces the override.
  const efBal = Number(plan.user.efund_balance || 0);
  const efTgt = Number(plan.user.efund_target || 0);
  const efPct = Math.round(Number(plan.efSplit || '0.3') * 100);
  if (plan.efPreempted) {
    chips.push({ label: 'EF paused (goal pre-empt)', tone: 'on' });
  } else if (efTgt > 0 && efBal < efTgt && efPct > 0) {
    chips.push({ label: `${efPct}% surplus → EF`, tone: 'on' });
  }

  if (chips.length <= 1) return null; // Just strategy = nothing remarkable

  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 6,
        alignItems: 'center',
        fontSize: 11,
        marginBottom: 8,
      }}
    >
      <span
        style={{
          color: 'var(--muted)',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
        }}
      >
        Assumptions
        <InfoTip>
          <strong>What's baked into this chart.</strong> Each chip below is a
          model the engine applied. Toggles for them live elsewhere on /plan —
          this strip just summarises what's currently active so you know which
          combination produced the number.
          <div style={{ marginTop: 8 }}>
            • <strong>Strategy</strong> — how extra surplus is allocated across
            loans. Click the strategy label above the chart to see definitions.
          </div>
          <div style={{ marginTop: 4 }}>
            • <strong>+N% hike</strong> — your stated annual salary increase,
            compounded yearly.
          </div>
          <div style={{ marginTop: 4 }}>
            • <strong>N% inflation</strong> — expenses grow monthly so surplus
            shrinks over time.
          </div>
          <div style={{ marginTop: 4 }}>
            • <strong>FX drift</strong> — projected ₹/$ rate drift for users
            with hybrid (INR + USD) debts.
          </div>
          <div style={{ marginTop: 4 }}>
            • <strong>Tax-saving reinvest</strong> — annual tax refunds get
            routed back into your highest-rate loan.
          </div>
          <div style={{ marginTop: 4 }}>
            • <strong>30% surplus → EF</strong> — soft waterfall: a third of
            each month's surplus tops up your emergency fund until the target
            is hit. Active when EF balance &lt; target.
          </div>
        </InfoTip>
        :
      </span>
      {chips.map((c) => (
        <span
          key={c.label}
          style={{
            padding: '2px 8px',
            borderRadius: 10,
            border: `1px solid ${c.tone === 'on' ? 'var(--accent)' : 'var(--border)'}`,
            color: c.tone === 'on' ? 'var(--accent)' : 'var(--ink)',
            background: c.tone === 'on' ? 'transparent' : 'var(--canvas)',
            whiteSpace: 'nowrap',
          }}
        >
          {c.label}
        </span>
      ))}
    </div>
  );
}
