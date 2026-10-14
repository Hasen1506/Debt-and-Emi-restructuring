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

import { localTerms, paymentWords } from '@/lib/terms';
import type { PlanData } from './PlanData';
import { useState } from 'react';
import type { CompareResponse } from '@/lib/api';
import { planWithWhatIf } from '@/lib/trajectory';
import { loanLabel } from '@/lib/loan-types';
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
import { payThisMonth } from '@/lib/pay-this-month';
import { dec } from '@/lib/safe-decimal';
import { describeGap, emiBelowInterest, type ProfileGap } from '@/lib/loan-gaps';
import { LOAN_TYPE_NAME } from '@/lib/loan-types';
import type { StoredProfile } from '@/lib/user-store';
import { PlanTrajectory } from './PlanTrajectory';
import { PlanPace } from './PlanPace';
import { RateDecisions } from './RateDecisions';
import { WhatIfPanel } from '@/components/WhatIfPanel';
import { LifecycleArrivalPrompts } from '@/components/lifecycle/LifecycleArrivalPrompts';
import { LifecycleEventsPanel } from '@/components/lifecycle/LifecycleEventsPanel';
import { FxCachePersister } from './FxCachePersister';
import { ActivityImpactBanner } from './ActivityImpactBanner';
import { AdvanceTaxPanel } from './AdvanceTaxPanel';
import { PlanSchedule } from './PlanSchedule';
import { DebtFreeRedirectPrompt } from './DebtFreeRedirectPrompt';
import { PrepayKeepSplit } from '@/components/insights/PrepayKeepSplit';
import { PlanNotes } from './PlanNotes';
import { PlanAssumptions } from './PlanAssumptions';
import { PlanGivens } from './PlanGivens';
import { TenureWhatIf } from './TenureWhatIf';
import { dueVsAffordable, gapRateWords, shortHeadline } from '@/lib/plan-gap';

export function LedgerPlan({ plan }: { plan: PlanData }) {
  // Live test L#26: the tenure what-if redraws the chart and table, with a
  // clear toggle back to the plan as it is.
  const [whatIf, setWhatIf] = useState<{ r: CompareResponse; loanIndex: number; months: number } | null>(null);
  const [showBase, setShowBase] = useState(false);
  const whatIfPlan = whatIf ? planWithWhatIf(plan, whatIf.r, whatIf.loanIndex) : null;
  const shownPlan = whatIfPlan && !showBase ? whatIfPlan : plan;
  const ccy = plan.displayCurrency;
  const fc = (v: string | number) => formatCurrencyWhole(v, ccy);
  const interestSaved =
    Number(plan.baselineInterest) - Number(plan.totalInterest);
  const limit = saneLimit(plan);
  const sane = (v: number) => Number.isFinite(v) && Math.abs(v) <= limit;
  // Short of cash this month: the schedule below pays minimums the user
  // can't fund, so its date isn't one to plan around.
  const short = plan.shortfall > 0 || !!plan.futureShortfall;
  const label = (m: number) => monthIndexToCountryLabel(m, plan.user.country).toUpperCase();
  // Live test #16: one story, each date named. Audit 80+ A5: short, the
  // headline is the gap; the date if it closes and the date as things stand
  // (gap borrowed, the schedule's date) are in the line under it.
  const shortStory = short
    ? shortHeadline({
        shortfall: plan.shortfall,
        asIsMonth: plan.debtFreeMonth,
        closedMonth: plan.gap?.closed?.debtFreeMonth,
        label,
        money: (v) => fc(Math.round(v)),
      })
    : null;
  // A gap that is never repaid only grows: its interest total is not a
  // number to plan with.
  const tenureWhatIf = (
    <TenureWhatIf
      plan={plan}
      onResult={(r, loanIndex, months) => {
        setWhatIf(r && r.scenario_trajectory?.length ? { r, loanIndex, months } : null);
        setShowBase(false);
      }}
    />
  );
  const gapRunsAway = !!plan.gap?.firstBorrowMonth && !plan.debtFreeMonth;
  const clearLabel = shortStory
    ? shortStory.value
    : plan.debtFreeMonth
      ? monthIndexToCountryLabel(plan.debtFreeMonth, plan.user.country).toUpperCase()
      : 'NOT IN LIFETIME';
  // What the plan pays the banks this month (EMIs, card minimums and the
  // extra), in the user's currency. Summing scheduled EMIs mixed ₹ and $,
  // counted paid-off loans and missed card minimums with no EMI set.
  // R9-3: the same whole-rupee EMIs + minimums + extra Home's "This month"
  // strip says, so Plan, Home and the cash flow agree to the rupee.
  const ptm = payThisMonth(plan);
  const monthlyOutlay =
    (ptm ? ptm.duesUser + ptm.extraUser : undefined) ??
    plan.monthlyPayments.find((p) => p.month === 1)?.totalPaid ??
    deriveMetrics({ user: plan.user, marginalRate: plan.marginalRate } as StoredProfile)
      .emiBurden.toNumber() +
      Math.max(0, plan.surplusAllocation?.debtSlice ?? plan.surplus);
  // When paying only the minimums clears it (null: not within the plan).
  const lastMinOwed = plan.trajectory.filter((p) => p.minimums > 0.5).at(-1)?.month ?? 0;
  const baselineClear = plan.trajectory.find((p) => p.month > lastMinOwed && p.minimums <= 0.5)?.month ?? null;
  // Live re-test NEW-2: when paying only the minimums never clears, its
  // interest total compounds for 100 years (25-digit figures); there is no
  // honest ₹ difference to print.
  const minimumsNeverClear = !!plan.baselineNeverClears || baselineClear === null;
  // Nothing owed: every loan on file is at 0, or there are none.
  const debtFreeNow = !plan.user.loans.some((l) => dec(l.outstanding).gt(0));

  if (debtFreeNow) return <DebtFreeNow hasLoans={plan.user.loans.length > 0} />;
  if (plan.gaps.length > 0) return <NeedsLoanDetails gaps={plan.gaps} />;
  if (plan.nonAmortising && plan.nonAmortising.length > 0)
    return <NeverClears plan={plan} fc={fc} />;

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

        {/* What the plan assumes (editable chips), the data and guesses it
            rests on, then what it comes to */}
        {/* What this page is for, in one line (each tab opens with one) */}
        <p style={{ margin: 0, fontSize: 13, lineHeight: 1.6, color: L_T.inkSoft }}>
          When you&apos;ll be debt-free and how: the date, each month&apos;s payments, and changes you can try before you make them.
        </p>
        <PlanAssumptions plan={plan} />
        <PlanGivens plan={plan} />
        <LKpi
          cols={4}
          items={[
            shortStory
              ? {
                  l: 'DEBT-FREE',
                  v: clearLabel,
                  s: shortStory.sub,
                  tone: L_T.negative,
                }
              : {
                  l: 'DEBT-FREE',
                  v: clearLabel,
                  s: plan.debtFreeMonth
                    ? `IN ${monthsSpan(plan.debtFreeMonth).toUpperCase()}`
                    : 'RAISE SURPLUS OR CUT SPEND TO CLEAR',
                },
            gapRunsAway || (!plan.debtFreeMonth && !sane(Number(plan.totalInterest)))
              ? {
                  l: 'TOTAL INTEREST',
                  v: '—',
                  s: gapRunsAway ? 'THE GAP BORROWING KEEPS GROWING' : "DOESN'T CLEAR AT THESE FIGURES",
                  tone: L_T.negative,
                }
              : {
                  l: 'TOTAL INTEREST',
                  v: fc(plan.totalInterest),
                  s:
                    plan.gap && plan.gap.totalInterest >= 1
                      ? `INCL. ${fc(Math.round(plan.gap.totalInterest))} ON GAP BORROWING`
                      : minimumsNeverClear
                        ? 'MINIMUMS ALONE NEVER CLEAR IT'
                        : interestSaved >= 1 && sane(interestSaved)
                          ? `${fc(interestSaved)} LESS THAN MINIMUMS`
                          : 'SAME AS PAYING MINIMUMS',
                  // UX50 B-15: interest is a cost; not in the "good" colour.
                  tone: L_T.ink,
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
            plan.shortfall > 0
              ? (() => {
                  // Live test #24: what's due beside what the month covers.
                  const d = dueVsAffordable({
                    income: dec(plan.user.monthly_income).toNumber(),
                    costs: dec(plan.user.fixed_expenses).add(dec(plan.user.variable_expenses)).toNumber(),
                    shortfall: plan.shortfall,
                  });
                  return {
                    l: 'DUE THIS MONTH',
                    v: fc(Math.round(d.due)),
                    s: `YOU CAN COVER ${fc(Math.round(d.canCover))} · SHORT ${fc(Math.round(d.short))}`,
                    tone: L_T.negative,
                  };
                })()
              : {
                  l: 'PAYING THIS MONTH',
                  v: fc(monthlyOutlay),
                  s: localTerms('EMIS + MINIMUMS + EXTRA', plan.user.country),
                },
          ]}
        />
        {/* A four-screen page: one tap to the part you came for */}
        <nav aria-label="On this page" data-print="hide" style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px', fontSize: 11, alignItems: 'center' }}>
          <span style={{ color: L_T.muted, letterSpacing: '0.1em' }}>JUMP TO</span>
          {/* In page order */}
          <LBracket href="#schedule">MONTH BY MONTH</LBracket>
          <LBracket href="#rate-decisions">RATE DECISIONS</LBracket>
          <LBracket href="#life-events">LIFE EVENTS</LBracket>
          <LBracket href="#notes">NOTES</LBracket>
          <LBracket href="#what-if">WHAT IF</LBracket>
          {/* Setup shows a plan after one loan; the rest are added from here (sprint G10, grill #16b). */}
          <LBracket accent href="/onboarding?step=loans" label="+ Loan: add another loan to the plan">+ LOAN</LBracket>
        </nav>

        {/* What actually reached the debts, beside what the plan puts in */}
        {!short && <PlanPace plan={plan} />}

        {plan.shortfall > 0 && <ShortfallBanner plan={plan} />}
        {/* Live re-test L#26: offered whether or not this month is short.
            UX50 B-15: up here only when short; otherwise after the chart and
            the table (a longer tenure costs more for someone who isn't short). */}
        {short && tenureWhatIf}
        {plan.futureShortfall && <div role="alert" style={{color:L_T.negative,fontSize:12}}>
          FUTURE FUNDING GAP · SHORT {fc(plan.futureShortfall.amount)} IN {monthIndexToCountryLabel(plan.futureShortfall.month,plan.user.country).toUpperCase()}.
          {plan.gap
            ? ` The forecast pays that gap from your emergency fund, then borrows the rest on a card at ${gapRateWords(plan.gap.rate)} a year and pays it back first. Revise the planned loan, income or expenses before relying on a payoff date.`
            : ' Revise the planned loan, income or expenses before relying on a payoff date.'}
        </div>}
        {plan.user.loans.some(l=>l.planned_effective_month) && <div style={{fontSize:12}}>
          Forecast includes planned loans: {plan.user.loans.filter(l=>l.planned_effective_month).map(l=>
            `${l.bank} from ${monthIndexToCountryLabel(l.planned_effective_month!,plan.user.country)}`).join('; ')}.
          Confirm, postpone or cancel the event when the date arrives.
        </div>}
        <FxCachePersister rates={plan.fxRatesUsed} />
        <LifecycleArrivalPrompts user={plan.user} variant="ledger" />

        {whatIfPlan && whatIf && (
          <div
            role="status"
            data-testid="whatif-toggle"
            style={{ border: `2px solid ${L_T.accent}`, padding: '8px 12px', fontSize: 11, letterSpacing: '0.08em', display: 'flex', flexWrap: 'wrap', gap: '6px 14px', alignItems: 'center' }}
          >
            <strong style={{ color: showBase ? L_T.ink : L_T.accent }}>
              {showBase
                ? 'SHOWING YOUR PLAN AS IT IS'
                : `SHOWING THE WHAT-IF · ${loanLabel(plan.user.loans[whatIf.loanIndex]).toUpperCase()} +${whatIf.months / 12} YR${whatIf.months > 12 ? 'S' : ''}`}
            </strong>
            <LBracket onClick={() => setShowBase((v) => !v)}>{showBase ? 'SHOW THE WHAT-IF' : 'BACK TO MY PLAN'}</LBracket>
            <span style={{ color: L_T.muted }}>Nothing is saved.</span>
          </div>
        )}
        <PlanTrajectory plan={shownPlan} short={short} />
        {!short && (
          <div data-print="hide">
            <DebtFreeRedirectPrompt plan={plan} />
          </div>
        )}
        {/* Audit 80+ A4: once only cheap debt is left, prepay, keep or split: the user's call. */}
        {!short && plan.runArgs && (
          <div id="prepay-keep-split" data-print="hide" style={{ scrollMarginTop: 16 }}>
            <PrepayKeepSplit runArgs={{ ...plan.runArgs, strategy: plan.strategy }} />
          </div>
        )}

        {/* Month by month, collapsed to the months something happens;
            the next rate reset below */}
        <PlanSchedule plan={shownPlan} />
        {!short && tenureWhatIf}

        {/* The next RBI / Fed decision, loan by loan, and whether to wait */}
        <RateDecisions plan={plan} />

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
        <section id="what-if" data-print="hide" style={{ scrollMarginTop: 16 }}>
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
  const d = dueVsAffordable({ income, costs, shortfall: plan.shortfall });
  const gap = plan.gap;
  const ccy = plan.displayCurrency;
  const card = gap
    ? `${gap.basis === 'your_card' ? 'your dearest card' : 'a card'} at ${gapRateWords(gap.rate)} a year${ccy === 'INR' ? ' plus 18% GST on the interest' : ''}`
    : 'a card';
  return (
    <section
      role="status"
      style={{ border: `2px solid ${L_T.negative}`, padding: '14px 18px', fontSize: 12, lineHeight: 1.7 }}
    >
      <div style={{ fontWeight: 700, color: L_T.negative, letterSpacing: '0.08em', marginBottom: 6 }}>
        SHORT {fc(plan.shortfall)} A MONTH
      </div>
      <dl style={{ display: 'grid', gridTemplateColumns: 'auto auto', justifyContent: 'start', gap: '2px 18px', margin: '0 0 8px' }}>
        <dt>{localTerms('Due this month (EMIs and minimums)', plan.user.country)}</dt>
        <dd style={{ margin: 0, textAlign: 'right', fontWeight: 700 }}>{fc(d.due)}</dd>
        <dt>What your income covers after costs</dt>
        <dd style={{ margin: 0, textAlign: 'right', fontWeight: 700 }}>{fc(d.canCover)}</dd>
        <dt>Short</dt>
        <dd style={{ margin: 0, textAlign: 'right', fontWeight: 700, color: L_T.negative }}>{fc(d.short)}</dd>
      </dl>
      Your costs ({fc(costs)}) and minimum payments ({fc(minimums)}) come to more
      than your income ({fc(income)}). The schedule below is <strong>as things stand</strong>:
      each short month is {Number(plan.user.efund_balance ?? 0) > 0 ? 'paid from your emergency fund while it lasts, then ' : ''}
      borrowed on {card}, and any money freed later pays that borrowing back
      first, before any loan gets extra.
      {gap && gap.peak > 0 && gap.peakMonth && !gap.repaidMonth
        ? ' At this income the borrowing is never repaid: it grows without limit.'
        : gap && gap.peak > 0 && gap.peakMonth
        ? ` The borrowing peaks at ${fc(gap.peak)} in ${monthIndexToCountryLabel(gap.peakMonth, plan.user.country)}${gap.repaidMonth ? ` and is repaid by ${monthIndexToCountryLabel(gap.repaidMonth, plan.user.country)}` : ' and is never repaid at this income'}.`
        : ''}{' '}
      Missing a payment instead costs late fees and hurts your credit score. Close
      the gap first: cut costs (try the what-if below), raise income, or ask the
      bank for a lower payment (try a longer tenure below, or move a card balance
      to a cheaper loan).
      {gap?.closed && (
        <div style={{ marginTop: 6 }}>
          With the gap closed ({fc(gap.closed.cut)} a month less spending), you&apos;d be debt-free{' '}
          {gap.closed.debtFreeMonth ? `in ${monthIndexToCountryLabel(gap.closed.debtFreeMonth, plan.user.country)}` : 'later than 30 years from now'}.
        </div>
      )}
      {gap?.basis === 'default' && gap.source && (
        <div style={{ marginTop: 6, fontSize: 10, color: L_T.muted }}>Card rate used: {gap.source}.</div>
      )}
    </section>
  );
}

/** A loan is missing its rate or EMI: no projection until it's added. */
/** No figure on Plan may exceed 100× what is owed today (live re-test NEW-2). */
function saneLimit(plan: PlanData): number {
  const owed = plan.user.loans.reduce((s, l) => s + Math.max(0, Number(l.outstanding) || 0), 0);
  return Math.max(1, owed) * 100;
}

/** Live re-test NEW-3: one clear card instead of a 1,200-month schedule. */
function NeverClears({ plan, fc }: { plan: PlanData; fc: (v: number) => string }) {
  return (
    <LShell>
      <div role="alert" style={{ padding: '40px 0', fontFamily: L_MONO }}>
        <LCli>PLAN · A LOAN THAT NEVER CLEARS</LCli>
        <LRule length={200} />
        <div style={{ marginTop: 18, fontSize: 12, color: L_T.muted, lineHeight: 1.7 }}>
          {localTerms('There’s no payoff date: at these figures the EMI doesn’t cover the interest, so the balance never goes down.', plan.user.country)}
          <ul style={{ margin: '10px 0 14px', paddingLeft: 18, color: L_T.ink }}>
            {(plan.nonAmortising ?? []).map((b) => {
              const loan = plan.user.loans[b.loanIndex];
              const name = loan ? `${(loan.bank || 'Your').toUpperCase()} ${LOAN_TYPE_NAME[loan.loan_type].toUpperCase()}` : 'A LOAN';
              return (
                <li key={b.loanIndex}>
                  {name}: interest about {fc(Math.round(b.monthlyInterest))} a month, {paymentWords(plan.user.country).one} {fc(Math.round(b.scheduledEmi))}.
                  {loan && emiBelowInterest(loan, plan.user.country) ? ` ${emiBelowInterest(loan, plan.user.country)}` : ''}
                </li>
              );
            })}
          </ul>
          <LBracket href="/profile?step=loans">CHECK THE LOAN →</LBracket>
        </div>
      </div>
    </LShell>
  );
}

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
