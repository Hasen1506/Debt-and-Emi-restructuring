import { Card } from '@/components/Card';
import { DebtTrajectoryChart } from '@/components/DebtTrajectoryChart';
import { WhatIfPanel } from '@/components/WhatIfPanel';
import { StrategySwitcher } from '@/components/StrategySwitcher';
import { HikeToggle } from '@/components/HikeToggle';
import { STRATEGY_LABEL } from '@/lib/strategy';
import { MONTH_NAMES, FY_ANCHOR_MONTH, monthIndexToCountryLabel } from '@/lib/today';
import {
  formatINR,
  formatPct,
  type RestructuringOpportunity,
} from '@/lib/api';
import type { PlanData } from './PlanData';
import { ActivityImpactBanner } from './ActivityImpactBanner';
import { OpportunityAlternative, RelationshipBadge } from './OpportunityAlternative';

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
  const hikeRate = Number(plan.user.annual_hike_rate ?? '0');
  const hikeRatePct = hikeRate > 0 ? `${(hikeRate * 100).toFixed(0)}%` : '0%';
  const hikeMonthIdx = plan.user.hike_effective_month ?? FY_ANCHOR_MONTH[plan.user.country];
  const hikeMonthLabel = MONTH_NAMES[Math.max(0, Math.min(11, hikeMonthIdx - 1))];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <section>
        <h1 className="h1">Your debt-free trajectory</h1>
        <p className="muted">
          Built on the <strong>{STRATEGY_LABEL[plan.strategy].toLowerCase()}</strong>{' '}
          strategy. Your current{' '}
          <abbr title="Surplus = income − fixed expenses − scheduled EMIs. The cash you have left to deploy against debt above the minimums.">
            surplus
          </abbr>{' '}
          is{' '}
          <span
            className="num"
            style={{
              color: plan.surplus >= 0 ? 'var(--ink)' : 'var(--negative)',
            }}
          >
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
        <div style={{ marginTop: 14, display: 'flex', flexWrap: 'wrap', gap: 24 }}>
          <StrategySwitcher active={plan.strategy} variant="inline" />
          <HikeToggle
            active={plan.hikeModeling}
            hikeRatePct={hikeRatePct}
            hikeMonthLabel={hikeMonthLabel}
            variant="inline"
          />
        </div>
      </section>

      {plan.activityImpact && (
        <ActivityImpactBanner
          impact={plan.activityImpact}
          loans={plan.user.loans}
          country={plan.user.country}
          variant="inline"
        />
      )}

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
                Re-pricing existing debt usually beats paying it down faster — do these first.
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
              <div key={i}>
                <div
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
                        flexWrap: 'wrap',
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
                      {opp.target_is_existing_relationship && (
                        <RelationshipBadge variant="existing" />
                      )}
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
                <OpportunityAlternative opportunity={opp} variant="existing" />
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
            Debt-free by
          </div>
          <div className="num" style={{ fontSize: 22, fontWeight: 600 }}>
            {plan.debtFreeMonth
              ? monthIndexToCountryLabel(plan.debtFreeMonth, plan.user.country)
              : 'Beyond 20 yrs'}
          </div>
          <div className="muted" style={{ fontSize: 12 }}>
            {plan.debtFreeMonth
              ? `month ${plan.debtFreeMonth} on the avalanche schedule`
              : 'raise surplus or cut spending to clear inside the 240-month horizon'}
          </div>
        </Card>
        <Card>
          <div className="muted" style={{ fontSize: 12 }}>
            Interest you&apos;ll pay
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
            vs <span className="num">{formatINR(plan.baselineInterest)}</span>{' '}
            if you only ever paid the bank-required minimums
          </div>
        </Card>
        <Card>
          <div className="muted" style={{ fontSize: 12 }}>
            You save
          </div>
          <div
            className="num"
            style={{
              fontSize: 22,
              fontWeight: 600,
              color: 'var(--accent)',
            }}
          >
            {plan.monthsSaved} months
          </div>
          <div className="muted" style={{ fontSize: 12 }}>
            {plan.monthsSaved > 0
              ? `cleared sooner than the minimums-only path`
              : `you'd clear at the same time as paying minimums — your surplus is going to other places`}
          </div>
        </Card>
      </div>

      <Card>
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 16, fontWeight: 600 }}>What if…</div>
          <div className="muted" style={{ fontSize: 13 }}>
            Move a slider — see the impact in plain numbers. Nothing here
            updates your saved plan; it&apos;s a sandbox for &quot;if I did X,
            would it help?&quot;.
          </div>
        </div>
        <WhatIfPanel
          user={plan.user}
          marginalRate={plan.marginalRate}
          strategy={plan.strategy}
        />
      </Card>
    </div>
  );
}
