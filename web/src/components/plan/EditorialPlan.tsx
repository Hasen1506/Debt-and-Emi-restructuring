import { DebtTrajectoryChart } from '@/components/DebtTrajectoryChart';
import { WhatIfPanel } from '@/components/WhatIfPanel';
import { StrategySwitcher } from '@/components/StrategySwitcher';
import {
  STRATEGY_LABEL,
  STRATEGY_DESCRIPTION,
  STRATEGY_SHORT,
} from '@/lib/strategy';
import { formatINR, formatPct, monthIndexToLabel } from '@/lib/api';
import type { PlanData } from './PlanData';
import { ActivityImpactBanner } from './ActivityImpactBanner';

/**
 * Editorial Plan — "Chapter II · the path".
 *
 * Long-form narrative reading of the engine's trajectory + restructuring
 * results. Big serif headline tells the user how many months to free, body
 * prose explains the surplus/strategy assumptions, the chart sits in a
 * <figure> with an italic caption, restructuring opportunities are a
 * numbered ordered list ("Two ways to shave months off…"), and the
 * what-if panel is folded in below the article. Mirrors direction-a.jsx.
 */

function monthsUntilDebtFree(plan: PlanData): string {
  if (plan.debtFreeMonth == null) return 'sometime beyond the 20-year horizon';
  if (plan.debtFreeMonth === 1) return 'in one month';
  return `in ${plan.debtFreeMonth} months`;
}

export function EditorialPlan({ plan }: { plan: PlanData }) {
  const monthsLeft = monthsUntilDebtFree(plan);
  const opportunities = plan.opportunities.slice(0, 3);

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) 260px',
        gap: 48,
        paddingTop: 16,
      }}
    >
      <article style={{ maxWidth: 760 }}>
        <div
          style={{
            fontFamily: 'var(--font-sans)',
            fontSize: 11,
            letterSpacing: '0.15em',
            textTransform: 'uppercase',
            color: 'var(--soft)',
            marginBottom: 12,
          }}
        >
          Chapter II · the path
        </div>
        <h1
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 400,
            fontSize: 48,
            lineHeight: 1.1,
            letterSpacing: '-0.02em',
            margin: 0,
          }}
        >
          If you hold the line, you'll be free
          <br />
          <em style={{ fontStyle: 'italic', color: 'var(--accent)' }}>
            {monthsLeft}.
          </em>
        </h1>

        <p
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 17,
            lineHeight: 1.65,
            marginTop: 22,
            maxWidth: 620,
          }}
        >
          That assumes your{' '}
          <abbr title="Income minus fixed expenses minus scheduled EMIs — the cash you have left each month to deploy above the minimums.">
            surplus
          </abbr>{' '}
          stays at <strong>{formatINR(plan.surplus)}/mo</strong>, rates
          don&apos;t shock either way, and you stick with the{' '}
          <strong>{STRATEGY_LABEL[plan.strategy].toLowerCase()}</strong>{' '}
          strategy ({STRATEGY_SHORT[plan.strategy].replace(/\.$/, '')}).
          {opportunities.length > 0 && (
            <>
              {' '}
              The restructures below could arrive sooner — they&apos;re worth
              about{' '}
              <strong style={{ color: 'var(--positive)' }}>
                {formatINR(plan.totalAnnualSaving)}
              </strong>{' '}
              a year if you act on them.
            </>
          )}
        </p>

        {plan.activityImpact && (
          <ActivityImpactBanner
            impact={plan.activityImpact}
            loans={plan.user.loans}
            country={plan.user.country}
            variant="aside"
          />
        )}

        <figure
          style={{
            margin: '36px 0 12px',
            padding: '20px 0',
            borderTop: '1px solid var(--border)',
            borderBottom: '1px solid var(--border)',
          }}
        >
          <div
            style={{
              fontFamily: 'var(--font-sans)',
              fontSize: 10,
              letterSpacing: '0.15em',
              textTransform: 'uppercase',
              color: 'var(--soft)',
              marginBottom: 14,
            }}
          >
            The trajectory
          </div>
          <div style={{ height: 280 }}>
            <DebtTrajectoryChart data={plan.trajectory} />
          </div>
          <figcaption
            style={{
              fontFamily: 'var(--font-display)',
              fontStyle: 'italic',
              fontSize: 13,
              color: 'var(--muted)',
              marginTop: 12,
              textAlign: 'center',
            }}
          >
            Total balance over time. Solid: the avalanche path you're on.
            Dashed: paying minimums only.
          </figcaption>
        </figure>

        {opportunities.length > 0 && (
          <div style={{ marginTop: 36 }}>
            <div
              style={{
                fontFamily: 'var(--font-sans)',
                fontSize: 10,
                letterSpacing: '0.15em',
                textTransform: 'uppercase',
                color: 'var(--soft)',
                marginBottom: 14,
              }}
            >
              {opportunities.length === 1
                ? 'One way'
                : opportunities.length === 2
                  ? 'Two ways'
                  : 'Three ways'}{' '}
              to shave months off
            </div>
            <ol
              style={{
                fontFamily: 'var(--font-display)',
                fontSize: 16,
                lineHeight: 1.75,
                paddingLeft: 22,
                margin: 0,
              }}
            >
              {opportunities.map((opp, i) => (
                <li key={i} style={{ marginTop: i === 0 ? 0 : 10 }}>
                  <strong>{opp.headline}.</strong> {opp.rationale} Saves{' '}
                  <strong style={{ color: 'var(--positive)' }}>
                    {formatINR(opp.estimated_annual_saving)}
                  </strong>
                  /yr — rate {formatPct(opp.current_rate)} →{' '}
                  {formatPct(opp.target_rate)}.
                </li>
              ))}
            </ol>
          </div>
        )}

        <div
          style={{
            marginTop: 36,
            padding: '20px 0',
            borderTop: '1px solid var(--border)',
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: 24,
          }}
        >
          {[
            {
              v: plan.debtFreeMonth
                ? monthIndexToLabel(plan.debtFreeMonth)
                : 'Beyond 20 yrs',
              l: plan.debtFreeMonth
                ? 'debt-free, at this pace'
                : 'lift surplus to clear inside the 20-year horizon',
            },
            {
              v: formatINR(plan.totalInterest),
              l: `interest you'll pay · vs ${formatINR(plan.baselineInterest)} if minimums only`,
            },
            {
              v: `${plan.monthsSaved} mo`,
              l: 'sooner than the minimums-only path',
            },
          ].map((s) => (
            <div key={s.l}>
              <div
                style={{
                  fontFamily: 'var(--font-display)',
                  fontSize: 26,
                  fontWeight: 500,
                  lineHeight: 1.1,
                  color: 'var(--ink)',
                }}
              >
                {s.v}
              </div>
              <div
                className="muted"
                style={{
                  fontFamily: 'var(--font-sans)',
                  fontSize: 11,
                  marginTop: 6,
                  letterSpacing: '0.04em',
                }}
              >
                {s.l}
              </div>
            </div>
          ))}
        </div>

        <div
          style={{
            marginTop: 40,
            paddingTop: 24,
            borderTop: '1px solid var(--border)',
          }}
        >
          <div
            style={{
              fontFamily: 'var(--font-sans)',
              fontSize: 10,
              letterSpacing: '0.15em',
              textTransform: 'uppercase',
              color: 'var(--soft)',
              marginBottom: 14,
            }}
          >
            What if…
          </div>
          <p
            style={{
              fontFamily: 'var(--font-display)',
              fontStyle: 'italic',
              fontSize: 14,
              color: 'var(--muted)',
              marginBottom: 14,
            }}
          >
            Move a slider — see the impact in plain numbers. Nothing here
            saves to your plan; it&apos;s a sandbox for testing &quot;if I did
            X, would it help?&quot;.
          </p>
          <WhatIfPanel
            user={plan.user}
            marginalRate={plan.marginalRate}
            strategy={plan.strategy}
          />
        </div>
      </article>

      <aside
        style={{
          fontFamily: 'var(--font-sans)',
          fontSize: 11,
          color: 'var(--soft)',
          lineHeight: 1.6,
          paddingTop: 36,
        }}
      >
        <div
          style={{
            textTransform: 'uppercase',
            letterSpacing: '0.15em',
            marginBottom: 14,
            fontSize: 10,
          }}
        >
          On this page
        </div>
        <div
          style={{
            borderLeft: '2px solid var(--border)',
            paddingLeft: 12,
            marginBottom: 18,
          }}
        >
          <div
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 13,
              color: 'var(--ink)',
              fontStyle: 'italic',
              marginBottom: 6,
            }}
          >
            Strategy
          </div>
          <div
            style={{
              color: 'var(--ink)',
              fontSize: 12,
              lineHeight: 1.55,
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}
          >
            <StrategySwitcher active={plan.strategy} variant="inline" />
            <div style={{ color: 'var(--soft)', fontSize: 12 }}>
              {STRATEGY_DESCRIPTION[plan.strategy]}
            </div>
          </div>
        </div>

        <div
          style={{
            borderLeft: '2px solid var(--border)',
            paddingLeft: 12,
            marginBottom: 18,
          }}
        >
          <div
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 13,
              color: 'var(--ink)',
              fontStyle: 'italic',
              marginBottom: 6,
            }}
          >
            Current surplus
          </div>
          <div style={{ color: 'var(--ink)', fontSize: 12, lineHeight: 1.55 }}>
            <span
              className="num"
              style={{
                color: plan.surplus >= 0 ? 'var(--ink)' : 'var(--negative)',
              }}
            >
              {formatINR(plan.surplus)}/mo
            </span>{' '}
            — income minus fixed expenses minus scheduled EMIs. Adjusts in{' '}
            <a
              href="/onboarding"
              style={{ color: 'var(--accent)', textDecoration: 'underline' }}
            >
              setup
            </a>{' '}
            when income or fixed expenses change.
          </div>
        </div>

        {!plan.profileIsLive && (
          <div
            style={{
              borderLeft: '2px solid var(--accent)',
              paddingLeft: 12,
              marginBottom: 18,
            }}
          >
            <div
              style={{
                fontFamily: 'var(--font-display)',
                fontSize: 13,
                color: 'var(--accent)',
                fontStyle: 'italic',
                marginBottom: 6,
              }}
            >
              Demo data
            </div>
            <div style={{ color: 'var(--ink)', fontSize: 12, lineHeight: 1.55 }}>
              These are stub numbers.{' '}
              <a
                href="/onboarding"
                style={{
                  color: 'var(--accent)',
                  textDecoration: 'underline',
                }}
              >
                Set up your profile →
              </a>
            </div>
          </div>
        )}

        {!plan.live && (
          <div
            style={{
              borderLeft: '2px solid var(--soft)',
              paddingLeft: 12,
              marginBottom: 18,
              fontStyle: 'italic',
            }}
          >
            Engine offline. Numbers shown are the last good cached run.
          </div>
        )}
      </aside>
    </div>
  );
}
