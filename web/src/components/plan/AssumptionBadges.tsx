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

  // EF waterfall implicit toggle — fires when there's an EF gap.
  const efBal = Number(plan.user.efund_balance || 0);
  const efTgt = Number(plan.user.efund_target || 0);
  if (efTgt > 0 && efBal < efTgt) {
    chips.push({ label: '30% surplus → EF', tone: 'on' });
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
      <span style={{ color: 'var(--muted)' }}>Assumptions:</span>
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
