import { DebtTrajectoryChart } from '@/components/DebtTrajectoryChart';
import { WhatIfPanel } from '@/components/WhatIfPanel';
import { StrategySwitcher } from '@/components/StrategySwitcher';
import { HikeToggle } from '@/components/HikeToggle';
import { TaxReinvestToggle } from '@/components/TaxReinvestToggle';
import { InflationToggle } from '@/components/InflationToggle';
import { EfSplitSlider } from '@/components/EfSplitSlider';
import { PlanStartPicker } from '@/components/PlanStartPicker';
import { FxDriftToggle } from '@/components/FxDriftToggle';
import { STRATEGY_LABEL, STRATEGY_DESCRIPTION } from '@/lib/strategy';
import { MONTH_NAMES, FY_ANCHOR_MONTH, monthIndexToCountryLabel } from '@/lib/today';
import {
  formatCurrency,
  formatPct,
} from '@/lib/api';
import type { PlanData } from './PlanData';
import { LedgerScheduleTable } from './LedgerScheduleTable';
import { KeyClearanceDates } from './KeyClearanceDates';
import { DebtFreeRedirectPrompt } from './DebtFreeRedirectPrompt';
import { CentralBankHint } from './CentralBankHint';
import { SurplusWaterfall } from './SurplusWaterfall';
import { ActivityImpactBanner } from './ActivityImpactBanner';
import { AssumptionBadges } from './AssumptionBadges';
import { RecentActivitySummary } from './RecentActivitySummary';
import { TaxBreakdown } from './TaxBreakdown';
import { BracketTransitionAlert } from './BracketTransitionAlert';
import { AdvanceTaxPanel } from './AdvanceTaxPanel';
import {
  OpportunityAlternative,
  RelationshipBadge,
  RateAsOfBadge,
  EligibilityCaveat,
  UpdateTermsButton,
} from './OpportunityAlternative';
import { FxCachePersister } from './FxCachePersister';
import { LifecycleArrivalPrompts } from '@/components/lifecycle/LifecycleArrivalPrompts';
import { InfoTip } from '@/components/ToolPrimitives';
import { InvestVsPrepayCard } from './InvestVsPrepayCard';

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
  const marginalPct = (Number(plan.marginalRate) * 100).toFixed(0);
  const opportunities = plan.opportunities;
  const interestSaved = Number(plan.baselineInterest) - Number(plan.totalInterest);
  const strategyLabel = STRATEGY_LABEL[plan.strategy].toUpperCase();
  const hikeRate = Number(plan.user.annual_hike_rate ?? '0');
  const hikeRatePct = hikeRate > 0 ? `${(hikeRate * 100).toFixed(0)}%` : '0%';
  const inflRate = Number(plan.user.inflation_rate ?? '0');
  const inflRatePct = inflRate > 0 ? `${(inflRate * 100).toFixed(1)}%` : '0%';
  const hikeMonthIdx = plan.user.hike_effective_month ?? FY_ANCHOR_MONTH[plan.user.country];
  const hikeMonthLabel = MONTH_NAMES[Math.max(0, Math.min(11, hikeMonthIdx - 1))];
  const ccyList = plan.currenciesInPlay;
  const isHybrid = ccyList.length > 1;
  const fmt = (v: string | number) => formatCurrency(v, plan.displayCurrency);

  // Per-currency lines for hybrid users; single string otherwise.
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
  const interestSavedDisplay = isHybrid
    ? ccyList
        .map((c) => {
          const saved =
            (plan.byCurrencyBaseline[c]?.totalInterestScenario ?? 0) -
            (plan.byCurrency[c]?.totalInterestScenario ?? 0);
          return formatCurrency(Math.max(0, saved), c);
        })
        .join(' · ')
    : fmt(interestSaved);

  const kpis: Array<{
    l: string;
    v: string;
    c: string;
    sub: string;
    tip?: React.ReactNode;
  }> = [
    {
      l: 'DEBT-FREE BY',
      v: plan.debtFreeMonth
        ? monthIndexToCountryLabel(plan.debtFreeMonth, plan.user.country).toUpperCase()
        : 'NOT IN LIFETIME',
      c: 'var(--ink)',
      sub: plan.debtFreeMonth
        ? `MONTH ${plan.debtFreeMonth} ON AVALANCHE`
        : 'RAISE SURPLUS OR CUT SPEND TO CLEAR',
      tip: (
        <>
          The month every loan hits zero, assuming you keep paying the
          schedule below — minimums on every loan plus the entire surplus
          rotated through the strategy&apos;s top-priority loan.
          <div style={{ marginTop: 8 }}>
            Extra payments pull it in. Missed / partial entries push it out.
            &quot;Not in lifetime&quot; means even with the simulation running
            past 100 years, the surplus can&apos;t outrun the interest.
          </div>
        </>
      ),
    },
    {
      l: 'TOTAL INTEREST',
      v: totalInterestDisplay,
      c: 'var(--positive)',
      sub: `VS ${baselineInterestDisplay} IF MINIMUMS ONLY`,
      tip: (
        <>
          Total interest you&apos;ll pay across all loans from today until
          debt-free, on the current schedule. The comparison is the
          minimums-only baseline — so the gap is what attacking the
          highest-rate debt buys you.
        </>
      ),
    },
    {
      l: 'YOU SAVE',
      v: `${interestSavedDisplay} · ${plan.monthsSaved}MO`,
      c: 'var(--accent)',
      sub: 'INTEREST + TIME VS MINIMUMS',
      tip: (
        <>
          Two numbers: interest avoided versus paying only minimums, and how
          many months earlier you&apos;ll be debt-free.
          <div style={{ marginTop: 8 }}>
            If &quot;0mo&quot; — your surplus is going somewhere else (EF tier,
            tax sleeve, etc.). Check the assumption badges above the chart.
          </div>
        </>
      ),
    },
    {
      l: 'SURPLUS',
      v: `${fmt(plan.surplus)}/MO`,
      c: plan.surplus >= 0 ? 'var(--ink)' : 'var(--negative)',
      sub: 'INCOME − FIXED EXPENSES − EMIS',
      tip: (
        <>
          What&apos;s left over each month after your fixed expenses and
          minimum EMIs. This is the engine&apos;s ammunition — every rupee
          here is what gets routed into the priority loan.
          <div style={{ marginTop: 8 }}>
            Negative surplus means you&apos;re running short before extras —
            the schedule will fall back to minimums and the debt-free date
            won&apos;t improve.
          </div>
        </>
      ),
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
      <FxCachePersister rates={plan.fxRatesUsed} />

      {/* 1. KPI strip — the answer first. */}
      <section>
        <SectionLabel>
          $ PLAN · STRATEGY = {strategyLabel} · MARGINAL = {marginalPct}%
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
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                }}
              >
                {s.l}
                {s.tip && <InfoTip>{s.tip}</InfoTip>}
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

      <LifecycleArrivalPrompts user={plan.user} variant="ledger" />

      <CentralBankHint
        country={plan.user.country}
        hasFloating={plan.user.loans.some((l) => l.rate_type === 'floating')}
      />

      {/* 2. Modeling toggles — visible but compact, collapsed by default. */}
      <details>
        <summary
          style={{
            cursor: 'pointer',
            fontSize: 11,
            color: 'var(--muted)',
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            padding: '4px 0',
          }}
        >
          $ MODELING · STRATEGY + TOGGLES
        </summary>
        <div
          style={{
            marginTop: 8,
            fontSize: 11,
            color: 'var(--muted)',
            letterSpacing: '0.04em',
            lineHeight: 1.65,
            background: 'var(--card)',
            border: '1px dashed var(--border)',
            padding: '10px 12px',
            fontFamily: 'var(--font-mono)',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          <StrategySwitcher
            active={plan.strategy}
            variant="ledger"
            compare={plan.strategyCompare}
            country={plan.user.country}
          />
          <PlanStartPicker active={plan.planStart} variant="ledger" />
          <HikeToggle
            active={plan.hikeModeling}
            hikeRatePct={hikeRatePct}
            hikeMonthLabel={hikeMonthLabel}
            hikePhases={plan.user.hike_schedule}
            variant="ledger"
          />
          <TaxReinvestToggle
            active={plan.taxReinvest}
            totalProjectedSaving={formatCurrency(
              plan.taxReinvestProjection
                .reduce((sum, e) => sum + Number(e.amount), 0)
                .toFixed(0),
              plan.displayCurrency,
            )}
            variant="ledger"
          />
          <InflationToggle
            active={plan.inflationModeling}
            inflationRatePct={inflRatePct}
            variant="ledger"
          />
          <EfSplitSlider
            active={plan.efSplit}
            hasGap={
              Number(plan.user.efund_target || 0) > 0 &&
              Number(plan.user.efund_balance || 0) <
                Number(plan.user.efund_target || 0)
            }
            ccySym={plan.user.country === 'IN' ? '₹' : '$'}
            variant="ledger"
          />
          {isHybrid && (
            <FxDriftToggle
              active={plan.fxDrift}
              driftLabel="INR +2.5%/yr (CPI differential)"
              variant="ledger"
            />
          )}
          <div style={{ color: 'var(--muted)', lineHeight: 1.6 }}>
            {STRATEGY_DESCRIPTION[plan.strategy]}
          </div>
        </div>
      </details>

      {/* 3. Trajectory — visual proof of the KPI strip. */}
      <section>
        <SectionLabel>$ TRAJECTORY · AVALANCHE VS MIN</SectionLabel>
        <AssumptionBadges plan={plan} />
        {isHybrid ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {ccyList.map((c) => (
              <div key={c}>
                <div
                  style={{
                    fontSize: 11,
                    color: 'var(--muted)',
                    letterSpacing: '0.18em',
                    fontFamily: 'var(--font-mono)',
                    marginBottom: 4,
                  }}
                >
                  {c} TRAJECTORY
                </div>
                <div
                  style={{
                    border: '1px solid var(--ink)',
                    background: 'var(--card)',
                    padding: 12,
                    height: 220,
                  }}
                >
                  <DebtTrajectoryChart data={plan.trajectory} currency={c} />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div
            style={{
              border: '1px solid var(--ink)',
              background: 'var(--card)',
              padding: 12,
              height: 320,
            }}
          >
            <DebtTrajectoryChart data={plan.trajectory} currency={plan.displayCurrency} />
          </div>
        )}
        <div
          style={{
            fontSize: 11,
            color: 'var(--muted)',
            letterSpacing: '0.04em',
            lineHeight: 1.6,
            marginTop: 8,
            fontFamily: 'var(--font-mono)',
          }}
        >
          <strong style={{ color: 'var(--ink)' }}>SOLID</strong> = balance under
          your plan (avalanche).{' '}
          <strong style={{ color: 'var(--ink)' }}>DASHED</strong> = balance if
          you only ever paid bank-required minimums. X-axis is months from
          today, Y-axis is total outstanding{isHybrid
            ? ' — one chart per currency, no cross-currency conversion'
            : plan.displayCurrency === 'INR'
              ? ' (₹L = lakhs, ₹k = thousands)'
              : ' ($k = thousands)'}.
        </div>
      </section>

      {/* 3.4 Surplus allocation waterfall — where each rupee goes. */}
      <SurplusWaterfall plan={plan} />

      {/* 3.5 Invest-vs-prepay decision card. */}
      <InvestVsPrepayCard plan={plan} variant="ledger" />

      {/* 4. Opportunities — highest-leverage action surface, moved up from #8. */}
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
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              $ RESTRUCTURE · {opportunities.length} OPP
              <InfoTip>
                <strong>Why this comes before the schedule.</strong> Refinancing
                or transferring a balance can cut your rate by 4–8 percentage
                points overnight; paying the same loan down faster only saves
                interest on the shrinking principal. The math almost always
                says re-price first, accelerate second.
                <div style={{ marginTop: 8 }}>
                  Each row picks the bank that wins for <em>you</em> —
                  preferring lenders you already deal with (no fresh KYC).
                  When a different bank is meaningfully cheaper we surface it
                  as a low-key &quot;also worth knowing&quot; line.
                </div>
              </InfoTip>
            </span>
            <span style={{ color: 'var(--positive)' }}>
              ANNUAL SAVING {fmt(plan.totalAnnualSaving)}
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
                <>
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
                      {opp.target_is_existing_relationship && (
                        <RelationshipBadge variant="ledger" />
                      )}
                      <RateAsOfBadge asOf={opp.target_rate_as_of} variant="ledger" />
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
                      {fmt(opp.estimated_annual_saving)}
                    </td>
                  </tr>
                  {opp.alternative_target_bank && (
                    <tr key={`${i}-alt`}>
                      <td colSpan={6} style={{ padding: '0 12px 6px' }}>
                        <EligibilityCaveat
                          kind={opp.kind}
                          country={plan.user.country}
                          variant="ledger"
                        />
                        <UpdateTermsButton
                          opportunity={opp}
                          user={plan.user}
                          currency={plan.displayCurrency}
                          variant="ledger"
                        />
                        <OpportunityAlternative opportunity={opp} variant="ledger" currency={plan.displayCurrency} />
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {/* 5. Activity banner — only when activity has shifted the plan. */}
      {plan.activityImpact && (
        <ActivityImpactBanner
          impact={plan.activityImpact}
          loans={plan.user.loans}
          country={plan.user.country}
          variant="ledger"
        />
      )}

      {/* 6. Bracket transition alert — conditional. */}
      <BracketTransitionAlert
        transitions={plan.bracketTransitions}
        country={plan.user.country}
        displayCurrency={plan.displayCurrency}
        variant="ledger"
      />

      {/* 7. Advance-tax — conditional, only for SE / high-income. */}
      {plan.advanceTaxSchedule && (
        <AdvanceTaxPanel
          schedule={plan.advanceTaxSchedule}
          country={plan.user.country}
          displayCurrency={plan.displayCurrency}
          monthlyPenaltyCost={plan.advanceTaxPenaltyMonthly}
          variant="ledger"
        />
      )}

      {/* 8. Tax planning — per-loan deduction projection. */}
      <TaxBreakdown
        user={{
          country: plan.user.country,
          loans: plan.user.loans,
          tax_regime: plan.user.tax_regime,
        }}
        variant="ledger"
      />

      {/* 9. Key clearance dates — the milestones that matter, each
       *  expandable to a short pre-clearance trajectory. The exhaustive
       *  month-by-month grid is one layer deeper, collapsed by default. */}
      <section>
        <SectionLabel>$ KEY DATES · WHEN THINGS CLEAR</SectionLabel>
        <DebtFreeRedirectPrompt plan={plan} variant="ledger" />
        <KeyClearanceDates plan={plan} />
      </section>
      <details>
        <summary
          style={{
            cursor: 'pointer',
            fontSize: 11,
            color: 'var(--muted)',
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            padding: '4px 0',
          }}
        >
          $ FULL MONTHLY GRID · {plan.trajectory.length} ROWS
        </summary>
        <div style={{ marginTop: 8 }}>
          <LedgerScheduleTable
            data={plan.trajectory}
            monthlyPayments={plan.monthlyPayments}
            loans={plan.user.loans}
            country={plan.user.country}
          />
        </div>
      </details>

      {/* Recent activity — between the schedule (what you should pay) and
       *  the what-if sandbox (what if you did X). */}
      <section>
        <RecentActivitySummary user={plan.user} />
      </section>

      {/* 10. What-if — sandbox, always last. */}
      <section>
        <SectionLabel>$ WHAT IF · TRY A SCENARIO</SectionLabel>
        <div
          style={{
            fontSize: 11,
            color: 'var(--muted)',
            letterSpacing: '0.04em',
            lineHeight: 1.6,
            marginBottom: 10,
            fontFamily: 'var(--font-mono)',
          }}
        >
          Move a slider, see the impact in plain numbers. Nothing here saves
          to your plan — it&apos;s for &quot;if I did X, would it help?&quot;.
        </div>
        <div
          style={{
            border: '1px solid var(--ink)',
            background: 'var(--card)',
            padding: '14px 16px',
          }}
        >
          <WhatIfPanel
            user={plan.user}
            marginalRate={plan.marginalRate}
            strategy={plan.strategy}
          />
        </div>
      </section>
    </div>
  );
}
