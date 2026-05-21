import { Card } from '@/components/Card';
import { DebtTrajectoryChart } from '@/components/DebtTrajectoryChart';
import { WhatIfPanel } from '@/components/WhatIfPanel';
import { StrategySwitcher } from '@/components/StrategySwitcher';
import { HikeToggle } from '@/components/HikeToggle';
import { TaxReinvestToggle } from '@/components/TaxReinvestToggle';
import { InflationToggle } from '@/components/InflationToggle';
import { FxDriftToggle } from '@/components/FxDriftToggle';
import { STRATEGY_LABEL } from '@/lib/strategy';
import { MONTH_NAMES, FY_ANCHOR_MONTH, monthIndexToCountryLabel } from '@/lib/today';
import {
  formatCurrency,
  formatPct,
  type RestructuringOpportunity,
} from '@/lib/api';
import type { PlanData } from './PlanData';
import { ActivityImpactBanner } from './ActivityImpactBanner';
import { TaxBreakdown } from './TaxBreakdown';
import { BracketTransitionAlert } from './BracketTransitionAlert';
import { AdvanceTaxPanel } from './AdvanceTaxPanel';
import { OpportunityAlternative, RelationshipBadge } from './OpportunityAlternative';
import { FxCachePersister } from './FxCachePersister';
import { LedgerScheduleTable } from './LedgerScheduleTable';
import { LifecycleArrivalPrompts } from '@/components/lifecycle/LifecycleArrivalPrompts';
import { AssumptionBadges } from './AssumptionBadges';
import { RecentActivitySummary } from './RecentActivitySummary';
import { InfoTip } from '@/components/ToolPrimitives';
import { InvestVsPrepayCard } from './InvestVsPrepayCard';

const KIND_LABEL: Record<RestructuringOpportunity['kind'], string> = {
  balance_transfer: 'Move card balance to a cheaper card',
  consolidation: 'Combine multiple loans into one',
  refinance: 'Replace this loan with a cheaper one',
};

const KIND_COLOR: Record<RestructuringOpportunity['kind'], string> = {
  balance_transfer: 'var(--accent)',
  consolidation: 'var(--positive)',
  refinance: 'var(--positive)',
};

export function ExistingPlan({ plan }: { plan: PlanData }) {
  const hikeRate = Number(plan.user.annual_hike_rate ?? '0');
  const hikeRatePct = hikeRate > 0 ? `${(hikeRate * 100).toFixed(0)}%` : '0%';
  const inflRate = Number(plan.user.inflation_rate ?? '0');
  const inflRatePct = inflRate > 0 ? `${(inflRate * 100).toFixed(1)}%` : '0%';
  const hikeMonthIdx = plan.user.hike_effective_month ?? FY_ANCHOR_MONTH[plan.user.country];
  const hikeMonthLabel = MONTH_NAMES[Math.max(0, Math.min(11, hikeMonthIdx - 1))];
  const ccyList = plan.currenciesInPlay;
  const isHybrid = ccyList.length > 1;
  const fmt = (v: string | number) => formatCurrency(v, plan.displayCurrency);
  const totalInterestDisplay = isHybrid
    ? ccyList
        .map((c) => formatCurrency(plan.byCurrency[c]?.totalInterestScenario ?? 0, c))
        .join(' · ')
    : fmt(plan.totalInterest);
  const baselineInterestDisplay = isHybrid
    ? ccyList
        .map((c) =>
          formatCurrency(plan.byCurrencyBaseline[c]?.totalInterestScenario ?? 0, c),
        )
        .join(' · ')
    : fmt(plan.baselineInterest);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <FxCachePersister rates={plan.fxRatesUsed} />
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
            {fmt(plan.surplus)}/mo
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
            hikePhases={plan.user.hike_schedule}
            variant="inline"
          />
          <TaxReinvestToggle
            active={plan.taxReinvest}
            totalProjectedSaving={formatCurrency(
              plan.taxReinvestProjection
                .reduce((sum, e) => sum + Number(e.amount), 0)
                .toFixed(0),
              plan.displayCurrency,
            )}
            variant="inline"
          />
          <InflationToggle
            active={plan.inflationModeling}
            inflationRatePct={inflRatePct}
            variant="inline"
          />
          {isHybrid && (
            <FxDriftToggle
              active={plan.fxDrift}
              driftLabel="INR +2.5%/yr (CPI differential)"
              variant="inline"
            />
          )}
        </div>
      </section>

      <LifecycleArrivalPrompts user={plan.user} variant="existing" />

      {/* 2. KPI cards — moved up to right under the title so the reader
       *  sees debt-free / interest / months-saved before scrolling. */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 12,
        }}
      >
        <Card>
          <div
            className="muted"
            style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 4 }}
          >
            Debt-free by
            <InfoTip>
              <strong>What this is.</strong> The month every loan hits zero,
              assuming you keep paying the schedule shown below — minimums on
              every loan, plus the entire surplus rotated through whichever
              loan the strategy attacks first.
              <div style={{ marginTop: 8 }}>
                <strong>What changes it.</strong> Pay extra → it pulls in.
                Miss / partial → it pushes out. The badges above the chart
                tell you which models (hike, inflation, FX drift, tax-saving
                reinvest) are baked into this date.
              </div>
              <div style={{ marginTop: 8 }}>
                <strong>"Beyond 20 yrs"</strong> means the engine couldn't
                clear inside the 240-month horizon at the current surplus —
                you need more surplus or a lower-rate refi.
              </div>
            </InfoTip>
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
            {totalInterestDisplay}
          </div>
          <div className="muted" style={{ fontSize: 12 }}>
            vs <span className="num">{baselineInterestDisplay}</span>{' '}
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

      {/* 3. Trajectory chart. */}
      <Card>
        <AssumptionBadges plan={plan} />
        <div className="muted" style={{ fontSize: 12 }}>
          Total debt over time (avalanche vs minimums)
          {isHybrid && (
            <>
              {' '}— shown per currency, no cross-currency conversion
            </>
          )}
        </div>
        {isHybrid ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 12 }}>
            {ccyList.map((c) => (
              <div key={c}>
                <div className="muted" style={{ fontSize: 11, marginBottom: 4 }}>
                  {c} trajectory
                </div>
                <div style={{ height: 220 }}>
                  <DebtTrajectoryChart data={plan.trajectory} currency={c} />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ height: 320, marginTop: 12 }}>
            <DebtTrajectoryChart
              data={plan.trajectory}
              currency={plan.displayCurrency}
            />
          </div>
        )}
      </Card>

      {/* 3.5 Invest-vs-prepay decision card — sits between the trajectory
       *  and the restructuring action surface. Anchors against the priority
       *  loan and the country's best safe vehicles after tax. */}
      <InvestVsPrepayCard plan={plan} variant="existing" />

      {/* 4. Opportunities — the action surface. */}
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
              <div
                style={{
                  fontSize: 16,
                  fontWeight: 600,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                Restructure before you accelerate
                <InfoTip>
                  <strong>Why first.</strong> A balance transfer or refi can
                  drop your rate by 4–8 percentage points overnight; paying
                  the same loan down faster only saves the interest on the
                  shrinking balance. The math almost always favours
                  re-pricing the debt before throwing more cash at it.
                  <div style={{ marginTop: 8 }}>
                    <strong>How we pick.</strong> Each card shows the bank
                    that wins for you specifically — preferring lenders you
                    already have a relationship with (no fresh KYC). When a
                    different bank is meaningfully cheaper, we surface that
                    as a low-key "also worth knowing" line below.
                  </div>
                  <div style={{ marginTop: 8 }}>
                    <strong>The savings number</strong> is annualised. One
                    refi can recover a year or two of surplus the avalanche
                    would have spent on interest.
                  </div>
                </InfoTip>
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
                {fmt(plan.totalAnnualSaving)}
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
                      {fmt(opp.estimated_annual_saving)}
                    </div>
                    <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
                      {formatPct(opp.current_rate)} → {formatPct(opp.target_rate)}
                    </div>
                  </div>
                </div>
                <OpportunityAlternative opportunity={opp} variant="existing" currency={plan.displayCurrency} />
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* 5-8. Context block — conditional alerts + tax planning, now after
       *  opportunities (was above them). Same order as ledger/editorial. */}
      {plan.activityImpact && (
        <ActivityImpactBanner
          impact={plan.activityImpact}
          loans={plan.user.loans}
          country={plan.user.country}
          variant="inline"
        />
      )}

      <BracketTransitionAlert
        transitions={plan.bracketTransitions}
        country={plan.user.country}
        displayCurrency={plan.displayCurrency}
        variant="inline"
      />

      {plan.advanceTaxSchedule && (
        <AdvanceTaxPanel
          schedule={plan.advanceTaxSchedule}
          country={plan.user.country}
          displayCurrency={plan.displayCurrency}
          monthlyPenaltyCost={plan.advanceTaxPenaltyMonthly}
          variant="inline"
        />
      )}

      <TaxBreakdown
        user={{
          country: plan.user.country,
          loans: plan.user.loans,
          tax_regime: plan.user.tax_regime,
        }}
        variant="inline"
      />

      {/* 9. Schedule — collapsed by default. Added for parity with the
       *  ledger/editorial skins; existing-skin used to skip the schedule
       *  entirely, which broke the audit trail. */}
      <Card>
        <details>
          <summary
            style={{
              cursor: 'pointer',
              fontSize: 14,
              fontWeight: 600,
            }}
          >
            Schedule — {plan.trajectory.length} months
          </summary>
          <div className="muted" style={{ fontSize: 13, marginTop: 8, marginBottom: 12 }}>
            Month-by-month: what you&apos;ll owe under the plan, what you&apos;d
            owe paying only minimums, and how far ahead you are. Click any
            month to see exactly which lender gets paid what.
          </div>
          <LedgerScheduleTable
            data={plan.trajectory}
            monthlyPayments={plan.monthlyPayments}
            loans={plan.user.loans}
            country={plan.user.country}
          />
        </details>
        <div style={{ marginTop: 16 }}>
          <RecentActivitySummary user={plan.user} />
        </div>
      </Card>

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
