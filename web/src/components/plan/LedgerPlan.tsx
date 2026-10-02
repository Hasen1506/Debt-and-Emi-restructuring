'use client';

/**
 * Plan (REDESIGN R3): when the debt clears, and what if.
 *
 * Top to bottom:
 *   1. "Schedule amended" when Activity has moved the plan
 *   2. What the plan assumes: facts from Profile, then one chip per
 *      assumption, each opening its control (PlanAssumptions)
 *   3. KPIs: debt-free, total interest, time saved, paying this month
 *   4. Trajectory, key dates, life events, amortisation, what-if
 *
 * Cheaper rates (restructuring) and this month's payments live on Home
 * (REDESIGN R2).
 */

import type { PlanData } from './PlanData';
import { formatCurrencyWhole } from '@/lib/api';
import {
  monthIndexToCountryLabel,
  monthsSpan,
} from '@/lib/today';
import {
  LShell,
  LSectionHeader,
  LCli,
  LKpi,
  LBracket,
  LRule,
  L_T,
  L_MONO,
} from '@/components/ledger/primitives';
import { deriveMetrics } from '@/lib/derived';
import { dec } from '@/lib/safe-decimal';
import { describeGap, type ProfileGap } from '@/lib/loan-gaps';
import { LOAN_TYPE_NAME } from '@/lib/loan-types';
import type { StoredProfile } from '@/lib/user-store';
import { PlanTrajectory } from './PlanTrajectory';
import { WhatIfPanel } from '@/components/WhatIfPanel';
import { LifecycleArrivalPrompts } from '@/components/lifecycle/LifecycleArrivalPrompts';
import { LifecycleEventsPanel } from '@/components/lifecycle/LifecycleEventsPanel';
import { FxCachePersister } from './FxCachePersister';
import { ActivityImpactBanner } from './ActivityImpactBanner';
import { AdvanceTaxPanel } from './AdvanceTaxPanel';
import { PlanSchedule } from './PlanSchedule';
import { DebtFreeRedirectPrompt } from './DebtFreeRedirectPrompt';
import { PlanNotes } from './PlanNotes';
import { PlanAssumptions } from './PlanAssumptions';

export function LedgerPlan({ plan }: { plan: PlanData }) {
  const ccy = plan.displayCurrency;
  const fc = (v: string | number) => formatCurrencyWhole(v, ccy);
  const interestSaved =
    Number(plan.baselineInterest) - Number(plan.totalInterest);
  // Short of cash this month: the schedule below pays minimums the user
  // can't fund, so its date isn't one to plan around.
  const short = plan.shortfall > 0 || !!plan.futureShortfall;
  const clearLabel = short
    ? 'NO DATE YET'
    : plan.debtFreeMonth
      ? monthIndexToCountryLabel(plan.debtFreeMonth, plan.user.country).toUpperCase()
      : 'NOT IN LIFETIME';
  // What the plan pays the banks this month (EMIs, card minimums and the
  // extra), in the user's currency. Summing scheduled EMIs mixed ₹ and $,
  // counted paid-off loans and missed card minimums with no EMI set.
  const monthlyOutlay =
    plan.monthlyPayments.find((p) => p.month === 1)?.totalPaid ??
    deriveMetrics({ user: plan.user, marginalRate: plan.marginalRate } as StoredProfile)
      .emiBurden.toNumber() +
      Math.max(0, plan.surplusAllocation?.debtSlice ?? plan.surplus);
  // When paying only the minimums clears it (null: not within the plan).
  const lastMinOwed = plan.trajectory.filter((p) => p.minimums > 0.5).at(-1)?.month ?? 0;
  const baselineClear = plan.trajectory.find((p) => p.month > lastMinOwed && p.minimums <= 0.5)?.month ?? null;
  // Nothing owed: every loan on file is at 0, or there are none.
  const debtFreeNow = !plan.user.loans.some((l) => dec(l.outstanding).gt(0));

  if (debtFreeNow) return <DebtFreeNow hasLoans={plan.user.loans.length > 0} />;
  if (plan.gaps.length > 0) return <NeedsLoanDetails gaps={plan.gaps} />;

  return (
    <LShell>
      <div
        style={{
          flex: 1,
          padding: '4px 0 0',
          display: 'flex',
          flexDirection: 'column',
          gap: 22,
          fontFamily: L_MONO,
        }}
      >
        {plan.activityImpact && (
          <ActivityImpactBanner
            impact={plan.activityImpact}
            loans={plan.user.loans}
            country={plan.user.country}
            variant="ledger"
          />
        )}

        {/* What the plan assumes (editable chips), then what it comes to */}
        <PlanAssumptions plan={plan} />
        <LKpi
          cols={4}
          items={[
            short
              ? {
                  l: 'DEBT-FREE',
                  v: clearLabel,
                  s: plan.shortfall > 0 ? `SHORT ${fc(Math.round(plan.shortfall))}/MO` : 'FUTURE PAYMENTS NEED FUNDING',
                  tone: L_T.negative,
                }
              : {
                  l: 'DEBT-FREE',
                  v: clearLabel,
                  s: plan.debtFreeMonth
                    ? `IN ${monthsSpan(plan.debtFreeMonth).toUpperCase()}`
                    : 'RAISE SURPLUS OR CUT SPEND TO CLEAR',
                },
            {
              l: 'TOTAL INTEREST',
              v: fc(plan.totalInterest),
              s: interestSaved >= 1 ? `${fc(interestSaved)} LESS THAN MINIMUMS` : 'SAME AS PAYING MINIMUMS',
              tone: L_T.positive,
            },
            {
              l: 'TIME SAVED',
              v: !short && plan.monthsSaved > 0 ? monthsSpan(plan.monthsSaved).toUpperCase() : '—',
              // The minimums can run past the plan's horizon (a card whose
              // minimum barely covers its interest): there's no date to compare.
              s: short
                ? 'NEEDS A PAYOFF DATE FIRST'
                : plan.monthsSaved > 0 || baselineClear
                  ? 'VS PAYING ONLY MINIMUMS'
                  : 'MINIMUMS ALONE NEVER CLEAR IT',
              tone: L_T.accent,
            },
            {
              l: 'PAYING THIS MONTH',
              v: fc(monthlyOutlay),
              s: 'EMIS + MINIMUMS + EXTRA',
            },
          ]}
        />

        {plan.shortfall > 0 && <ShortfallBanner plan={plan} />}
        {plan.futureShortfall && <div role="alert" style={{color:L_T.negative,fontSize:12}}>
          FUTURE FUNDING GAP · SHORT {fc(plan.futureShortfall.amount)} IN {monthIndexToCountryLabel(plan.futureShortfall.month,plan.user.country).toUpperCase()}.
          The forecast assumes all minimum payments are funded. Revise the planned loan, income or expenses before relying on a payoff date.
        </div>}
        {plan.user.loans.some(l=>l.planned_effective_month) && <div style={{fontSize:12}}>
          Forecast includes planned loans: {plan.user.loans.filter(l=>l.planned_effective_month).map(l=>
            `${l.bank} from ${monthIndexToCountryLabel(l.planned_effective_month!,plan.user.country)}`).join('; ')}.
          Confirm, postpone or cancel the event when the date arrives.
        </div>}
        <FxCachePersister rates={plan.fxRatesUsed} />
        <LifecycleArrivalPrompts user={plan.user} variant="ledger" />

        <PlanTrajectory plan={plan} short={short} />
        {!short && <DebtFreeRedirectPrompt plan={plan} />}

        {/* Month by month, collapsed to the months something happens;
            the next rate reset and the central bank's next meeting below */}
        <PlanSchedule plan={plan} />

        {/* Planned pay changes, new rates and new loans */}
        <div id="life-events" style={{ scrollMarginTop: 16 }}>
          <LifecycleEventsPanel user={plan.user} configuredLoans={plan.configuredUser.loans} />
        </div>

        {/* Prepay or save, the home loan's tax saving, a bracket change */}
        <PlanNotes plan={plan} />

        {plan.advanceTaxSchedule && (
          <AdvanceTaxPanel
            schedule={plan.advanceTaxSchedule}
            country={plan.user.country}
            displayCurrency={plan.displayCurrency}
            monthlyPenaltyCost={plan.advanceTaxPenaltyMonthly}
            variant="ledger"
          />
        )}

        {/* What if: real engine runs against this plan, nothing saved until asked */}
        <section id="what-if" style={{ scrollMarginTop: 16 }}>
          <LSectionHeader>What if</LSectionHeader>
          <p style={{ margin: '0 0 4px', fontSize: 12, color: L_T.muted, lineHeight: 1.6 }}>
            Each change re-runs your plan and shows what it does. Nothing is saved until you press the button under it.
          </p>
          <WhatIfPanel
            user={plan.runArgs?.user ?? { ...plan.user, loans: plan.user.loans.filter((l) => !l.planned_effective_month) }}
            configuredUser={plan.configuredUser}
            marginalRate={plan.marginalRate}
            strategy={plan.strategy}
            runArgs={plan.runArgs}
          />
        </section>
      </div>
    </LShell>
  );
}

// Re-export for type narrowing in the page wrapper.
export type { PlanData };

/** /plan when nothing is owed: the plan's cards (date, outlay, chart)
 *  would all be made up ("NOT IN LIFETIME", an outlay with no loans). */
/** Income doesn't cover costs plus minimums: say by how much and what the
 *  schedule assumes, instead of offering its date as a plan. */
function ShortfallBanner({ plan }: { plan: PlanData }) {
  const fc = (v: number) => formatCurrencyWhole(Math.round(v), plan.displayCurrency);
  const income = dec(plan.user.monthly_income).toNumber();
  const costs = dec(plan.user.fixed_expenses).add(dec(plan.user.variable_expenses)).toNumber();
  // The engine's minimums, so the three figures add up to its shortfall.
  const minimums = Math.max(0, plan.shortfall + income - costs);
  return (
    <section
      role="status"
      style={{ border: `2px solid ${L_T.negative}`, padding: '14px 18px', fontSize: 12, lineHeight: 1.7 }}
    >
      <div style={{ fontWeight: 700, color: L_T.negative, letterSpacing: '0.08em', marginBottom: 6 }}>
        $ SHORT {fc(plan.shortfall)} A MONTH · NO PAYOFF DATE YET
      </div>
      Your costs ({fc(costs)}) and minimum payments ({fc(minimums)}) come to more
      than your income ({fc(income)}). The schedule below assumes the minimums get
      paid anyway; each month they can&apos;t be, the balance grows and late fees
      start. First close the gap: cut costs (try the what-if below), raise income,
      or ask the bank for a lower payment (a longer tenure, or moving a card
      balance to a cheaper loan).
    </section>
  );
}

/** A loan is missing its rate or EMI: no projection until it's added. */
function NeedsLoanDetails({ gaps }: { gaps: ProfileGap[] }) {
  return (
    <LShell>
      <div style={{ padding: '40px 0', fontFamily: L_MONO }}>
        <LCli>PLAN · NEEDS YOUR LOAN DETAILS</LCli>
        <LRule length={200} />
        <div style={{ marginTop: 18, fontSize: 12, color: L_T.muted, lineHeight: 1.7 }}>
          There&apos;s no payoff date yet.{' '}
          {gaps.some((g) => g.missing.includes('fx'))
            ? 'Without an exchange rate a loan in another currency would be counted one-for-one, ₹ as $.'
            : 'Without these the plan would treat a loan as interest-free or never paid down.'}
          <ul style={{ margin: '10px 0 14px', paddingLeft: 18, color: L_T.ink }}>
            {gaps.map((g) => (
              <li key={g.index}>
                {(g.loan.bank || 'Your').toUpperCase()} {LOAN_TYPE_NAME[g.loan.loan_type].toUpperCase()}: add{' '}
                {describeGap(g.missing, g.loan)}
              </li>
            ))}
          </ul>
          <LBracket href="/profile?step=loans">ADD THE DETAILS →</LBracket>
        </div>
      </div>
    </LShell>
  );
}

function DebtFreeNow({ hasLoans }: { hasLoans: boolean }) {
  return (
    <LShell>
      <div style={{ padding: '40px 0', fontFamily: L_MONO }}>
        <LCli>{hasLoans ? 'PLAN · DEBT-FREE' : 'PLAN · NO DEBTS ON FILE'}</LCli>
        <LRule length={200} />
        <div style={{ marginTop: 18, fontSize: 12, color: L_T.muted, lineHeight: 1.7 }}>
          {hasLoans
            ? 'Every loan on file is paid off, so there is nothing to plan here. '
            : 'Add a loan to see your payoff date and monthly plan. '}
          <LBracket href="/goals">GOALS →</LBracket>{' '}
          <LBracket href="/profile?step=loans">{hasLoans ? 'ADD A LOAN →' : 'ADD YOUR LOANS →'}</LBracket>
        </div>
      </div>
    </LShell>
  );
}
