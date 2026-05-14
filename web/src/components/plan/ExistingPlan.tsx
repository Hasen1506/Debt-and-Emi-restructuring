import { Card } from '@/components/Card';
import { DebtTrajectoryChart } from '@/components/DebtTrajectoryChart';
import { WhatIfPanel } from '@/components/WhatIfPanel';
import {
  formatINR,
  formatPct,
  monthIndexToLabel,
  type RestructuringOpportunity,
} from '@/lib/api';
import type { PlanData } from './PlanData';

const KIND_LABEL: Record<RestructuringOpportunity['kind'], string> = {
  balance_transfer: 'Balance transfer',
  consolidation: 'Consolidate',
  refinance: 'Refinance',
};

const KIND_COLOR: Record<RestructuringOpportunity['kind'], string> = {
  balance_transfer: 'var(--accent)',
  consolidation: 'var(--positive)',
  refinance: 'var(--positive)',
};

export function ExistingPlan({ plan }: { plan: PlanData }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <section>
        <h1 className="h1">Your debt-free trajectory</h1>
        <p className="muted">
          Avalanche strategy, current surplus{' '}
          <span className="num" style={{ color: 'var(--ink)' }}>
            {formatINR(plan.surplus)}/mo
          </span>
          {!plan.profileIsLive && (
            <span
              className="chip"
              style={{ marginLeft: 8, color: 'var(--muted)' }}
            >
              demo profile · <a href="/onboarding">set up yours</a>
            </span>
          )}
          {!plan.live && (
            <span
              className="chip"
              style={{ marginLeft: 8, color: 'var(--muted)' }}
            >
              offline · sample data
            </span>
          )}
          .
        </p>
        {plan.profileIsLive && plan.live && (
          <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>
            Got a bonus, raise, or unexpected cash? Use{' '}
            <a href="/tools/windfall">Tools › Windfall</a> to model where it
            should go, then{' '}
            <a href="/tools/recompute">Recompute</a> to refresh this plan.
          </p>
        )}
      </section>

      {plan.opportunities.length > 0 && (
        <Card style={{ borderLeft: '3px solid var(--positive)' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'baseline',
              justifyContent: 'space-between',
              gap: 12,
              marginBottom: 12,
            }}
          >
            <div>
              <div style={{ fontSize: 16, fontWeight: 600 }}>
                Restructure before you accelerate
              </div>
              <div className="muted" style={{ fontSize: 13 }}>
                Layer 1 (§4.7) — re-pricing existing debt beats paying it down faster.
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div className="muted" style={{ fontSize: 12 }}>
                Estimated annual saving
              </div>
              <div
                className="num"
                style={{ fontSize: 22, fontWeight: 600, color: 'var(--positive)' }}
              >
                {formatINR(plan.totalAnnualSaving)}
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {plan.opportunities.map((opp, i) => (
              <div
                key={i}
                style={{
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  padding: 12,
                  display: 'grid',
                  gridTemplateColumns: '1fr auto',
                  gap: 12,
                  alignItems: 'start',
                }}
              >
                <div>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      marginBottom: 4,
                    }}
                  >
                    <span
                      className="chip"
                      style={{
                        background: 'transparent',
                        color: KIND_COLOR[opp.kind],
                        borderColor: KIND_COLOR[opp.kind],
                        fontSize: 11,
                      }}
                    >
                      {KIND_LABEL[opp.kind]}
                    </span>
                    <span style={{ fontWeight: 500 }}>{opp.headline}</span>
                  </div>
                  <div className="muted" style={{ fontSize: 13 }}>
                    {opp.rationale}
                  </div>
                </div>
                <div style={{ textAlign: 'right', minWidth: 120 }}>
                  <div className="muted" style={{ fontSize: 11 }}>
                    Saves / yr
                  </div>
                  <div
                    className="num"
                    style={{ fontWeight: 600, color: 'var(--positive)' }}
                  >
                    {formatINR(opp.estimated_annual_saving)}
                  </div>
                  <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
                    {formatPct(opp.current_rate)} → {formatPct(opp.target_rate)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card>
        <div className="muted" style={{ fontSize: 12 }}>
          Total debt over time (avalanche vs minimums)
        </div>
        <div style={{ height: 320, marginTop: 12 }}>
          <DebtTrajectoryChart data={plan.trajectory} />
        </div>
      </Card>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 12,
        }}
      >
        <Card>
          <div className="muted" style={{ fontSize: 12 }}>
            Debt-free date
          </div>
          <div className="num" style={{ fontSize: 22, fontWeight: 600 }}>
            {monthIndexToLabel(plan.debtFreeMonth)}
          </div>
        </Card>
        <Card>
          <div className="muted" style={{ fontSize: 12 }}>
            Total interest
          </div>
          <div
            className="num"
            style={{
              fontSize: 22,
              fontWeight: 600,
              color: 'var(--positive)',
            }}
          >
            {formatINR(plan.totalInterest)}
          </div>
          <div className="muted" style={{ fontSize: 12 }}>
            vs {formatINR(plan.baselineInterest)} paying minimums
          </div>
        </Card>
        <Card>
          <div className="muted" style={{ fontSize: 12 }}>
            Months saved
          </div>
          <div
            className="num"
            style={{
              fontSize: 22,
              fontWeight: 600,
              color: 'var(--accent)',
            }}
          >
            {plan.monthsSaved}
          </div>
        </Card>
      </div>

      <Card>
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 16, fontWeight: 600 }}>What if…</div>
          <div className="muted" style={{ fontSize: 13 }}>
            Move a slider — engine recomputes against your current schedule.
            Months and interest are versus today&apos;s avalanche plan.
          </div>
        </div>
        <WhatIfPanel user={plan.user} marginalRate={plan.marginalRate} />
      </Card>
    </div>
  );
}
