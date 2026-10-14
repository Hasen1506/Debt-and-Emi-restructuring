'use client';
/**
 * "What this plan takes as given" (AUDIT §10 M3), under Plan's choices:
 * the data and guesses the date rests on, each marked YOU SAID, ASSUMED
 * or CHECK, with where to change it. Closed to one line until opened;
 * a row to check opens it.
 */
import { useState } from 'react';
import type { PlanData } from './PlanData';
import { planGivens, type GivenSource } from '@/lib/plan-givens';
import { FY_ANCHOR_MONTH, getCountryToday, localIsoDate } from '@/lib/today';
import { LBracket, L_T } from '@/components/ledger/primitives';

const TONE: Record<GivenSource, string> = {
  'YOU SAID': L_T.muted,
  ASSUMED: L_T.ink,
  CHECK: L_T.negative,
};

export function PlanGivens({ plan }: { plan: PlanData }) {
  const u = plan.configuredUser;
  const givens = planGivens(u, {
    runArgs: plan.runArgs,
    today: localIsoDate(getCountryToday(u.country)),
    inflation: { on: plan.inflationModeling === 'on', rate: Number(plan.user.inflation_rate ?? 0) },
    hike: {
      on: plan.hikeModeling === 'on',
      rate: Number(u.annual_hike_rate ?? 0),
      month: u.hike_effective_month ?? FY_ANCHOR_MONTH[u.country],
    },
  });
  const assumed = givens.filter((g) => g.source === 'ASSUMED').length;
  const toCheck = givens.filter((g) => g.source === 'CHECK').length;
  const [open, setOpen] = useState(toCheck > 0);

  return (
    <section aria-labelledby="plan-givens-h" style={{ fontSize: 'var(--fs-dense)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'baseline' }}>
        <span id="plan-givens-h" style={{ fontWeight: 700, letterSpacing: '0.1em', fontSize: 'var(--fs-label)', fontFamily: 'var(--font-mono)' }}>
          WHAT THIS PLAN TAKES AS GIVEN
          <span style={{ fontWeight: 400, color: L_T.muted }}>
            {' '}· {assumed} ASSUMED
            {toCheck > 0 && <span style={{ color: L_T.negative }}> · {toCheck} TO CHECK</span>}
          </span>
        </span>
        <LBracket onClick={() => setOpen(!open)} label={open ? 'Hide what the plan takes as given' : 'Show what the plan takes as given'}>
          {open ? 'HIDE ↑' : 'SHOW ↓'}
        </LBracket>
      </div>
      {open && (
        <ol style={{ listStyle: 'none', margin: '8px 0 0', padding: 0, borderTop: `1px solid ${L_T.ink}` }}>
          {givens.map((g) => (
            <li
              key={g.key}
              style={{
                display: 'grid',
                gridTemplateColumns: 'minmax(0, 1fr) auto',
                columnGap: 10,
                rowGap: 4,
                padding: '10px 0',
                borderBottom: `1px dashed ${L_T.ruleSoft}`,
                lineHeight: 1.55,
              }}
            >
              <span style={{ fontWeight: 700 }}>{g.label}</span>
              <span style={{ fontSize: 'var(--fs-label)', fontFamily: 'var(--font-mono)', letterSpacing: '0.1em', color: TONE[g.source], fontWeight: g.source === 'YOU SAID' ? 400 : 700 }}>
                {g.source}
              </span>
              <div style={{ gridColumn: '1 / -1', color: L_T.inkSoft }}>
                {g.lines.map((line, i) => (
                  <div key={i}>{line}</div>
                ))}
                {g.fix && (
                  <div style={{ marginTop: 4 }}>
                    <LBracket href={g.fix.href}>{g.fix.text} →</LBracket>
                  </div>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
