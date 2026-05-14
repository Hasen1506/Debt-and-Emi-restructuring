import { DebtTrajectoryChart } from '@/components/DebtTrajectoryChart';
import { WhatIfPanel } from '@/components/WhatIfPanel';
import {
  formatINR,
  formatPct,
  monthIndexToLabel,
} from '@/lib/api';
import type { PlanData } from './PlanData';

/**
 * Ledger Plan — amortisation print-out.
 *
 * Header line ("$ PLAN · STRATEGY=AVALANCHE · HORIZON=240MO · MARGINAL=30%"),
 * 4-up KPI grid with 1px black grout, trajectory chart in a hard-bordered
 * frame, restructuring table (LENDER / KIND / RATE / SAVES/YR), and a
 * sensitivity panel at the bottom. Mirrors DPlan from direction-d.jsx.
 */

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 11,
        color: 'var(--muted)',
        letterSpacing: '0.18em',
        marginBottom: 6,
        fontFamily: 'var(--font-mono)',
      }}
    >
      {children}
    </div>
  );
}

export function LedgerPlan({ plan }: { plan: PlanData }) {
  const horizonMo = 240;
  const marginalPct = (Number(plan.marginalRate) * 100).toFixed(0);
  const opportunities = plan.opportunities;

  const kpis = [
    {
      l: 'CLEAR DATE',
      v: monthIndexToLabel(plan.debtFreeMonth).toUpperCase(),
      c: 'var(--ink)',
      sub: plan.debtFreeMonth ? `MONTH ${plan.debtFreeMonth} OF ${horizonMo}` : 'BEYOND HORIZON',
    },
    {
      l: 'TOTAL INTEREST',
      v: formatINR(plan.totalInterest),
      c: 'var(--positive)',
      sub: `VS ${formatINR(plan.baselineInterest)} BASE`,
    },
    {
      l: 'MONTHS SAVED',
      v: String(plan.monthsSaved),
      c: 'var(--accent)',
      sub: 'AGAINST MINIMUMS',
    },
    {
      l: 'SURPLUS',
      v: `${formatINR(plan.surplus)}/MO`,
      c: 'var(--ink)',
      sub: 'NET ALLOC',
    },
  ];

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 22,
        fontFamily: 'var(--font-mono)',
        fontSize: 12,
        lineHeight: 1.55,
      }}
    >
      <section>
        <SectionLabel>
          $ PLAN · STRATEGY = AVALANCHE · HORIZON = {horizonMo}MO · MARGINAL = {marginalPct}%
          {!plan.profileIsLive && ' · DEMO'}
          {!plan.live && ' · OFFLINE'}
        </SectionLabel>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gap: 1,
            background: 'var(--ink)',
            padding: 1,
          }}
        >
          {kpis.map((s) => (
            <div
              key={s.l}
              style={{ background: 'var(--canvas)', padding: '10px 12px' }}
            >
              <div
                style={{
                  fontSize: 10,
                  color: 'var(--muted)',
                  letterSpacing: '0.12em',
                  marginBottom: 4,
                }}
              >
                {s.l}
              </div>
              <div style={{ fontSize: 18, fontWeight: 700, color: s.c }}>
                {s.v}
              </div>
              <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 4 }}>
                {s.sub}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <SectionLabel>$ TRAJECTORY · AVALANCHE VS MIN</SectionLabel>
        <div
          style={{
            border: '1px solid var(--ink)',
            background: 'var(--card)',
            padding: 12,
            height: 320,
          }}
        >
          <DebtTrajectoryChart data={plan.trajectory} />
        </div>
      </section>

      {opportunities.length > 0 && (
        <section>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: 11,
              color: 'var(--muted)',
              letterSpacing: '0.18em',
              marginBottom: 6,
            }}
          >
            <span>$ RESTRUCTURE · {opportunities.length} OPP</span>
            <span style={{ color: 'var(--positive)' }}>
              ANNUAL SAVING {formatINR(plan.totalAnnualSaving)}
            </span>
          </div>
          <table
            style={{
              width: '100%',
              borderCollapse: 'collapse',
              fontSize: 12,
            }}
          >
            <thead>
              <tr
                style={{
                  borderTop: '2px solid var(--ink)',
                  borderBottom: '1px solid var(--ink)',
                }}
              >
                {['#', 'KIND', 'HEADLINE', 'CURRENT', 'TARGET', 'SAVES/YR'].map(
                  (h, i) => (
                    <th
                      key={h}
                      style={{
                        padding: '8px 12px',
                        textAlign: i > 2 ? 'right' : 'left',
                        fontWeight: 700,
                        letterSpacing: '0.08em',
                        fontSize: 10,
                        color: 'var(--muted)',
                      }}
                    >
                      {h}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {opportunities.map((opp, i) => (
                <tr
                  key={i}
                  style={{ borderBottom: '1px dashed var(--dash)' }}
                >
                  <td style={{ padding: '10px 12px', color: 'var(--muted)' }}>
                    {String(i + 1).padStart(2, '0')}
                  </td>
                  <td
                    style={{
                      padding: '10px 12px',
                      textTransform: 'uppercase',
                      letterSpacing: '0.06em',
                    }}
                  >
                    {opp.kind.replace('_', ' ')}
                  </td>
                  <td style={{ padding: '10px 12px', fontWeight: 600 }}>
                    {opp.headline}
                  </td>
                  <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                    {formatPct(opp.current_rate)}
                  </td>
                  <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                    {formatPct(opp.target_rate)}
                  </td>
                  <td
                    style={{
                      padding: '10px 12px',
                      textAlign: 'right',
                      fontWeight: 700,
                      color: 'var(--positive)',
                    }}
                  >
                    {formatINR(opp.estimated_annual_saving)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section>
        <SectionLabel>$ SENSITIVITY · ADJUST + RECOMPUTE</SectionLabel>
        <div
          style={{
            border: '1px solid var(--ink)',
            background: 'var(--card)',
            padding: '14px 16px',
          }}
        >
          <WhatIfPanel user={plan.user} marginalRate={plan.marginalRate} />
        </div>
      </section>
    </div>
  );
}
