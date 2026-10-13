/**
 * The debt-free date as a range beside the exact month (grill #24, sprint
 * G4). Same engine run as the headline (plan.runArgs), re-run with floating
 * rates ±1 point and ±1 month of pay by POST /api/sensitivity/range; the
 * "Why this range" lines come from lib/payoff-range so the words match the
 * engine's scenarios. Renders nothing when there's no date to bracket.
 *
 * Integrator: place <HomeDebtFreeRange /> under HomeDebtFreeCaption in
 * Home (HomeDebtFree.tsx is also edited by L2, so G4 left it alone).
 */
import { cache } from 'react';
import { loadPlanFromCookies } from '@/components/plan/load-plan';
import { api } from '@/lib/api';
import { monthIndexToCountryLabel } from '@/lib/today';
import { RANGE_TERMS, whyThisRange, type PayoffRange } from '@/lib/payoff-range';

const loadPlanOnce = cache(loadPlanFromCookies);

export function rangeWords(r: PayoffRange, label: (m: number) => string): string | null {
  if (r.exact == null || r.earliest == null) return null;
  if (r.latest == null) return `LIKELY ${label(r.earliest).toUpperCase()} OR LATER`;
  if (r.latest === r.earliest) return null;
  return `LIKELY ${label(r.earliest).toUpperCase()} – ${label(r.latest).toUpperCase()}`;
}

export async function HomeDebtFreeRange() {
  const plan = await loadPlanOnce();
  if (!plan.live || !plan.runArgs || !plan.debtFreeMonth || plan.gaps.length > 0 || plan.shortfall > 0) return null;
  const r = await api.sensitivityRange(plan.runArgs).catch(() => null);
  if (!r) return null;
  const label = (m: number) => monthIndexToCountryLabel(m, plan.user.country);
  const words = rangeWords(r, label);
  if (!words) return null;
  return (
    <details style={{ marginTop: 4, fontSize: 12 }}>
      <summary style={{ cursor: 'pointer' }}>{words} · WHY THIS RANGE</summary>
      <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
        {whyThisRange(r).map((line) => <li key={line}>{line}</li>)}
      </ul>
      <p style={{ margin: '6px 0 0', opacity: 0.8 }}>{RANGE_TERMS.sensitivity} {RANGE_TERMS.rate_drift}</p>
    </details>
  );
}
