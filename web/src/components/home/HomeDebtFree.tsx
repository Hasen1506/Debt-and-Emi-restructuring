/**
 * The home page's debt-free date and "this month" move: the same engine
 * run /plan shows, so the two can't disagree. Streamed in (the page wraps these in <Suspense>), so
 * the rest of home paints without waiting on the engine.
 */
import { localTerms } from '@/lib/terms';
import { dueVsAffordable, dueVsAffordableLine, notFundable, shortGapLine, shortValue } from '@/lib/plan-gap';
import { userMarginalCosts } from '@/lib/marginal-cost';
import { rateLine, whyFirstShort } from '@/lib/card-rate';
import { cache } from 'react';
import Link from 'next/link';
import { loadPlanFromCookies } from '@/components/plan/load-plan';
import { MONTH_NAMES, getCountryToday, monthIndexToCountryLabel, monthsSpan } from '@/lib/today';
import { payThisMonth } from '@/lib/pay-this-month';
import { PayNotice, PayThisMonth } from './PayThisMonth';
import { HomeProgress } from './HomeProgress';
import { retentionInputs } from '@/lib/retention-inputs';
import { localIsoDate } from '@/lib/today';
import { HomeRestructure } from './HomeRestructure';
import { LBracket } from '@/components/ledger/primitives';
import { extraSaving, loanClearsMonth, thisMonthMove } from '@/lib/this-month';
import { deriveMetrics, type LoanWithEffective } from '@/lib/derived';
import { describeGap } from '@/lib/loan-gaps';
import { LOAN_TYPE_NAME } from '@/lib/loan-types';
import { needsHelp } from '@/lib/loan-status';
import { formatCurrencyWhole } from '@/lib/api';
import { fmt as fmtPct } from '@/lib/effective-apr';
import { formatLoanAmount, userDefaultCurrency } from '@/lib/currency';
import { homeInterestLine, homeThisMonthLine } from '@/lib/home-this-month';
import { HomeThisMonth } from './HomeThisMonth';
import { CashFlow } from './LedgerHome';
import { InsightsPanel } from '@/components/insights/InsightsPanel';
import { shortPriority, shortPriorityOrder } from '@/lib/short-priority';

// One engine run per request, shared by the value and its caption.
const loadPlanOnce = cache(loadPlanFromCookies);

/** UX walkthrough fix 9: a shortfall reads red, a date green, and the rest
 *  (no date yet, see plan) in ink; never a gap in green. */
const SHORT_TONE = { color: 'var(--negative)' } as const;
const DATE_TONE = { color: 'var(--positive)' } as const;
const CAPTION_TONE = { color: 'inherit' } as const;

export async function HomeDebtFreeValue() {
  return <span data-testid="home-debt-free-value">{await debtFreeValue()}</span>;
}

async function debtFreeValue() {
  const plan = await loadPlanOnce();
  // Audit 80+ A5: short this month, the headline is the gap, not the date it
  // would take to close it; that date is demoted to the caption (shortGapLine).
  if (plan.gaps.length === 0 && plan.shortfall > 0)
    return <span style={SHORT_TONE}>{shortValue(plan.shortfall, (v) => formatCurrencyWhole(v, userDefaultCurrency(plan.user.country)))}</span>;
  // W1b / audit 80+ C11: a later month the gap credit limit can't carry leads
  // with that month's gap, not a date.
  if (plan.gaps.length === 0 && plan.infeasibleFrom != null && plan.futureShortfall)
    return <span style={SHORT_TONE}>{shortValue(plan.futureShortfall.amount, (v) => formatCurrencyWhole(v, userDefaultCurrency(plan.user.country)))}</span>;
  if (plan.gaps.length > 0 || plan.shortfall > 0 || plan.futureShortfall) return <>NO DATE YET</>;
  if (!plan.live) return <Link href="/plan" className="l-hit">SEE PLAN →</Link>;
  // 0 = nothing owed now; null = not cleared within the horizon.
  if (plan.debtFreeMonth === 0) return <span style={DATE_TONE}>NOW</span>;
  if (!plan.debtFreeMonth) return <>NOT ON THIS PLAN</>;
  return <span style={DATE_TONE}>{monthIndexToCountryLabel(plan.debtFreeMonth, plan.user.country).toUpperCase()}</span>;
}

export async function HomeDebtFreeCaption() {
  const plan = await loadPlanOnce();
  if (plan.gaps.length > 0) return <Link href="/profile?step=loans" className="l-hit">ADD LOAN DETAILS →</Link>;
  if (plan.shortfall > 0) {
    return (
      <Link href="/plan" className="l-hit" style={SHORT_TONE}>
        {/* Live re-test 7 R7-2: Plan's and Setup's words, as-is date included. */}
        {(
          shortGapLine({
            shortfall: plan.shortfall,
            asIsMonth: plan.debtFreeMonth,
            closedMonth: plan.gap?.closed?.debtFreeMonth,
            infeasibleFrom: plan.infeasibleFrom,
            label: (m) => monthIndexToCountryLabel(m, plan.user.country),
            money: (v) => formatCurrencyWhole(Math.round(v), userDefaultCurrency(plan.user.country)),
          }) ?? ''
        ).toUpperCase()}{' '}
        · PLAN →
      </Link>
    );
  }
  if (plan.futureShortfall && plan.infeasibleFrom != null)
    return (
      <Link href="/plan" className="l-hit">
        FROM {monthIndexToCountryLabel(plan.futureShortfall.month, plan.user.country).toUpperCase()} ·{' '}
        {notFundable(plan.infeasibleFrom, (m) => monthIndexToCountryLabel(m, plan.user.country)).toUpperCase()} · PLAN →
      </Link>
    );
  if (plan.futureShortfall) return <Link href="/plan" className="l-hit">FUTURE PAYMENTS NEED FUNDING · SEE PLAN →</Link>;
  if (!plan.live) return <>DATE + MONTHLY SCHEDULE</>;
  if (plan.debtFreeMonth === 0) return <>NOTHING OWED</>;
  if (!plan.debtFreeMonth) return <Link href="/plan" className="l-hit">RAISE SURPLUS · SEE PLAN →</Link>;
  // The date rests on what goes to debts each month and on rates staying
  // where they are; said with it (the rest is on Plan's "takes as given").
  const savedRates = plan.runArgs?.user.loans.some(l => l.rate_type === 'floating' && Number(l.rate_drift_annualized)) ||
    plan.runArgs?.lifecycle_events?.some(e => e.kind === 'floating_rate_reset');
  const rateWords = savedRates ? 'WITH YOUR SAVED RATE CHANGES' : 'RATES AS TODAY';
  const toDebts = plan.monthlyPayments.find((p) => p.month === 1)?.totalPaid;
  const fc = (v: number) => formatCurrencyWhole(Math.round(v), userDefaultCurrency(plan.user.country));
  // What's actually been paid lately, when it moves the date (lib/pace).
  const pace = plan.pace;
  const atPace =
    pace?.differs && pace.average && pace.debtFreeMonth && pace.debtFreeMonth !== plan.debtFreeMonth
      ? ` · AT THE ${fc(pace.average)}/MO YOU'VE PAID: ${monthIndexToCountryLabel(pace.debtFreeMonth, plan.user.country).toUpperCase()}`
      : '';
  return (
    <Link href="/plan" className="l-hit" style={CAPTION_TONE}>
      IN {monthsSpan(plan.debtFreeMonth).toUpperCase()}
      {toDebts ? ` · AT ${fc(toDebts)}/MO TO DEBTS, ${rateWords}` : ''}
      {atPace} · PLAN →
    </Link>
  );
}

/** The calm view's one step, from the plan's first month. */
const oneStepWords = cache(async (): Promise<string> => {
  const plan = await loadPlanOnce();
  const profile = { user: plan.user, marginalRate: plan.marginalRate, creditScore: null, isLive: plan.profileIsLive };
  const m = deriveMetrics(profile);
  const fc = (v: number) => formatCurrencyWhole(v, userDefaultCurrency(profile.user.country));
  if (plan.gaps.length > 0) return 'ADD YOUR LOAN DETAILS IN PROFILE.';
  // R3B-2 (#13): no "pay the minimum" for a loan that is behind or with collectors.
  if (profile.user.loans.some(needsHelp)) return 'A LOAN IS BEHIND OR WITH COLLECTORS: START WITH THE STEPS ABOVE, THEN THE REST.';
  // Short of cash: the engine's gap (costs + minimums − income) when it
  // ran, else the same sum from the profile.
  const short = plan.live ? plan.shortfall : Math.max(0, -Number(m.surplus));
  if (short > 0) return 'PAY AT LEAST THE MINIMUMS. IF YOU CAN’T, CALL THE BANK BEFORE THE DUE DATE.';
  const move = thisMonthMove(plan);
  if (m.surplus.lte(0) || !move) return localTerms('KEEP CURRENT EMIS RUNNING.', profile.user.country);
  const first = move.targets[0];
  const loan = first ? profile.user.loans[first.index] : undefined;
  if (first && loan) {
    // In the loan's own currency (₹ for an NRI's Indian loan).
    const amount = formatLoanAmount(first.amount, loan, profile.user.country, plan.fxRatesUsed);
    return `PAY ${amount} EXTRA TO YOUR ${loan.bank ? `${loan.bank.toUpperCase()} ` : ''}${(LOAN_TYPE_NAME[loan.loan_type] ?? 'loan').toUpperCase()}.`;
  }
  if (move.ef > 0) return `PUT ${fc(move.ef)} IN YOUR EMERGENCY FUND.`;
  return localTerms('KEEP CURRENT EMIS RUNNING.', profile.user.country);
});

export async function HomeMoveOneStep() {
  return <>{await oneStepWords()}</>;
}

/** Why the strategy puts the extra on this loan. */
const REASON: Record<string, (rate: string) => string> = {
  avalanche: (rate) => `the next payment saves the most here (${rate})`,
  snowball: (rate) => `it's the smallest balance (${rate})`,
  rules: (rate) => `your rules put it first (${rate})`,
};

/** The reason in plain words, when the breakdown after it gives the rates. */
const WHY: Record<string, string> = {
  avalanche: 'it costs the most',
  snowball: "it's the smallest balance",
  rules: 'your rules put it first',
};

/** The loan's rate as its statement shows it, then what it costs a year
 *  when that differs: compounding, a card's GST, or a tax break. */
// Audit 80 B13/E2: the one rate wording (lib/card-rate).
function rateWords(l: LoanWithEffective, _country: string): string {
  return rateLine(l.nominal, l.effective);
}

/** This month's payments, one row each, to tick off (REDESIGN R2.2). */
export async function HomePayThisMonth() {
  const plan = await loadPlanOnce();
  const country = plan.user.country;
  const today = getCountryToday(country);
  const monthLabel = `${MONTH_NAMES[today.getMonth()]} ${today.getFullYear()}`;
  const fc = (v: number) => formatCurrencyWhole(Math.round(v), userDefaultCurrency(country));
  if (plan.gaps.length > 0) {
    const g = plan.gaps[0];
    return (
      <PayNotice title={`Pay this month · ${monthLabel}`}>
        Add {describeGap(g.missing, g.loan)} for your {g.loan.bank ? `${g.loan.bank} ` : ''}
        {LOAN_TYPE_NAME[g.loan.loan_type]}
        {plan.gaps.length > 1 ? ` (and ${plan.gaps.length - 1} more)` : ''}. Without it the plan can&apos;t work out
        what to pay. <LBracket active href="/profile?step=loans">ADD THE DETAILS</LBracket>
      </PayNotice>
    );
  }
  const data = payThisMonth(plan);
  if (!data || data.rows.length === 0) {
    if (plan.live) {
      return (
        <PayNotice title={`Pay this month · ${monthLabel}`}>
          {localTerms('No loan payment is due this month. Check each loan’s first EMI date below.', plan.user.country)}
        </PayNotice>
      );
    }
    return (
      <PayNotice title={`Pay this month · ${monthLabel}`}>
        {localTerms('The plan engine can’t be reached right now, so this month’s payments aren’t worked out. Your EMIs are due as usual.', plan.user.country)} <LBracket href="/plan">TRY THE PLAN →</LBracket>
      </PayNotice>
    );
  }
  // Why the top extra goes where it does, and what it saves in a year.
  const m = deriveMetrics({ user: plan.user, marginalRate: plan.marginalRate, creditScore: null, isLive: plan.profileIsLive });
  const top = data.rows.find((r) => r.kind === 'extra' || r.kind === 'clears');
  const target = top ? m.loans.find((l) => l.index === top.loanIndex) : undefined;
  // "Why this loan first" (roadmap PR J): what the next payment on it saves,
  // broken down the way the payoff order ranks it.
  const mc = target ? userMarginalCosts(plan.user, plan.marginalRate).get(target.index) : undefined;
  // One rate per sentence: with the breakdown, the statement rate is the
  // only other number (a card read 42%, 49.56% and 60.31% in one line).
  const several = m.loans.filter((l) => l.outstanding.gt(0)).length > 1;
  const why = target
    ? mc
      ? `${several ? `The extra goes here because ${WHY[plan.strategy] ?? WHY.avalanche}.` : 'The extra goes on your only loan.'} ${whyFirstShort(mc.total, target.nominal)}. `
      : `${several ? `The extra goes here: ${(REASON[plan.strategy] ?? REASON.avalanche)(rateWords(target, country))}` : `The extra goes on your only loan, at ${rateWords(target, country)}`}. `
    : '';
  const reason =
    top && target
      ? {
          key: top.key,
          text: `${why}${plan.payoffOrderNote ? `${plan.payoffOrderNote} ` : ''}${savesLine(top.extra, mc ? mc.total.toNumber() : target.effective.toNumber(), loanClearsMonth(plan, target.index), (v) => formatCurrencyWhole(v, top.currency), plan.user.country)}`,
        }
      : undefined;
  // Live test #24: what's due beside what the month can cover.
  const alert =
    plan.shortfall > 0
      ? `${dueVsAffordableLine(
          dueVsAffordable({
            income: Number(plan.user.monthly_income) || 0,
            costs: (Number(plan.user.fixed_expenses) || 0) + (Number(plan.user.variable_expenses) || 0),
            shortfall: plan.shortfall,
          }),
          (v) => fc(Math.round(v)),
        )} ${shortPriorityOrder(shortPriority(data, plan.user.loans, plan.shortfall), fc, country)} A missed payment is reported to the credit bureaus and brings late fees.`
      : plan.futureShortfall
        ? `From ${monthIndexToCountryLabel(plan.futureShortfall.month, country)}, the payments need more than you earn. See the plan.`
        : undefined;
  // G7: progress under the register (months shaved, share card, prompts).
  const open = plan.user.loans.filter((l) => Number(l.outstanding) > 0);
  const datedPlan = plan.live && plan.shortfall <= 0 && !plan.futureShortfall ? plan.debtFreeMonth : null;
  return (
    <>
      <PayThisMonth
        data={data}
        loans={plan.user.loans}
        country={country}
        monthLabel={monthLabel}
        reason={reason}
        alert={alert}
      />
      <HomeProgress
        country={country}
        todayIso={localIsoDate(today)}
        debtFreeMonth={datedPlan}
        loans={open.map((l) => ({
          type: LOAN_TYPE_NAME[l.loan_type],
          outstanding: Number(l.outstanding),
          ratePct: l.nominal_rate ? Math.round(Number(l.nominal_rate) * 10000) / 100 : null,
          emi: Number(l.scheduled_emi) > 0 ? Number(l.scheduled_emi) : null,
          currency: l.currency ?? userDefaultCurrency(country),
        }))}
        loansCleared={plan.user.loans.length - open.length}
        shortLine={
          // UX50 B-13: the same story as the Home and Plan headline.
          plan.shortfall > 0
            ? plan.gap?.closed?.debtFreeMonth
              ? `Debt-free in ${monthIndexToCountryLabel(plan.gap.closed.debtFreeMonth, country)} if the ${fc(plan.shortfall)}/mo gap closes${plan.debtFreeMonth ? ` (as things stand: ${monthIndexToCountryLabel(plan.debtFreeMonth, country)})` : ''}. Once it closes, this counts the months you take off.`
              : `No debt-free date while you're ${fc(plan.shortfall)} a month short. Once the gap closes, this counts the months you take off.`
            : undefined
        }
        pay={data}
        firstBalanceYm={plan.user.loans.map((l) => l.balance_as_of?.slice(0, 7)).filter((x): x is string => !!x).sort()[0] ?? null}
        strategy={plan.strategy}
        monthLabel={monthLabel}
        {...retentionInputs(plan.user.loans, data, country)}
      />
    </>
  );
}

/** UX50 B-11: what to do this month, in one line at the top of Home. The
 *  same engine run as the list below (cached per request). */
export async function HomeThisMonthStrip() {
  const plan = await loadPlanOnce();
  if (plan.gaps.length > 0 || !plan.live) return null;
  const fc = (v: number) => formatCurrencyWhole(Math.round(v), userDefaultCurrency(plan.user.country));
  const data = payThisMonth(plan);
  const line = homeThisMonthLine(data, plan.shortfall, fc, plan.user.country, plan.user.loans);
  if (!line || !data) return null;
  // Re-test 9 O-3: the strip notices payments logged this month.
  const progress = {
    rows: data.rows.map(({ key, loanIndex, minimum, amount, amountUser }) => ({ key, loanIndex, minimum, amount, amountUser })),
    loans: plan.user.loans,
    country: plan.user.country,
    total: data.total,
  };
  return <HomeThisMonth line={line} progress={progress} />;
}

/** UX2B-12: "It saves about ₹X of interest a year", or, when the plan
 *  clears the loan sooner, "… before it's cleared in <month>". */
function savesLine(extra: number, cost: number, clears: number | null, money: (v: number) => string, country: 'IN' | 'US'): string {
  const s = extraSaving(extra, cost, clears);
  return s.months < 12 && clears != null
    ? `It saves about ${money(s.amount)} of interest before the loan is cleared in ${monthIndexToCountryLabel(clears, country)}.`
    : `It saves about ${money(s.amount)} of interest a year.`;
}

/** UX2B-8: this month's EMIs and minimums from the same run as "This month"
 *  (6 cards read ₹26,590 there and ₹26,887 in the cash flow below, from the
 *  profile's own minimum estimate). Null when the plan has no month 1. */
async function planDues(): Promise<number | undefined> {
  const plan = await loadPlanOnce();
  if (!plan.live || plan.gaps.length > 0) return undefined;
  return payThisMonth(plan)?.duesUser;
}

const planProfile = (plan: Awaited<ReturnType<typeof loadPlanOnce>>) => ({ user: plan.user, marginalRate: plan.marginalRate, creditScore: null, isLive: plan.profileIsLive });

export async function HomeCashFlow() {
  return <CashFlow profile={planProfile(await loadPlanOnce())} dues={await planDues()} />;
}

export async function HomeDuesTotal() {
  const plan = await loadPlanOnce();
  const dues = await planDues();
  return <>{formatCurrencyWhole(dues ?? deriveMetrics(planProfile(plan)).emiBurden.toNumber(), userDefaultCurrency(plan.user.country))}</>;
}

/** Cheaper rates the engine found for these loans (REDESIGN R2.4). */
export async function HomeCheaperRates() {
  const plan = await loadPlanOnce();
  if (plan.gaps.length > 0 || (plan.opportunities.length === 0 && plan.heldBack.length === 0)) return null;
  return (
    <HomeRestructure
      opportunities={plan.opportunities}
      heldBack={plan.heldBack}
      user={plan.user}
      totalAnnualSaving={plan.totalAnnualSaving}
    />
  );
}

/**
 * Re-test 10 observation: Home's INTEREST tile said ₹6,500/MO "charged this
 * month" (balance × rate ÷ 12 today) while Plan and its CSV said October's
 * interest is ₹6,929. The engine's figure is the one the bank charges: a
 * card's interest on its average daily balance with 18% GST on it (India).
 * The tile now reads that same month-1 figure, so the two agree; with no
 * live plan it falls back to today's balance × rate and says so.
 */
export async function HomeInterestValue() {
  const { value } = await homeInterest();
  return <>{value}</>;
}

export async function HomeInterestCaption() {
  const { caption } = await homeInterest();
  return <>{caption}</>;
}

async function homeInterest(): Promise<{ value: string; caption: string }> {
  const plan = await loadPlanOnce();
  const ccy = userDefaultCurrency(plan.user.country);
  const money = (v: number) => formatCurrencyWhole(v, ccy);
  const first = plan.live && plan.gaps.length === 0 ? plan.trajectory.find((p) => p.month === 1) : undefined;
  if (first?.interest != null) return homeInterestLine({ planInterest: first.interest, monthLabel: monthIndexToCountryLabel(1, plan.user.country), fallback: 0, money });
  const m = deriveMetrics({ user: plan.user, marginalRate: plan.marginalRate, creditScore: null, isLive: plan.profileIsLive });
  return homeInterestLine({ planInterest: null, monthLabel: '', fallback: m.monthlyInterest.toNumber(), money });
}

/** Audit 80+ A1/A5/A6 (+ the A4 nudge and "Don't sign that"): first on Home. */
export async function HomeInsights() {
  const plan = await loadPlanOnce();
  if (!plan.live || !plan.runArgs || plan.gaps.length > 0) return null;
  return (
    <InsightsPanel runArgs={{ ...plan.runArgs, strategy: plan.strategy }} variant="home" closedDebtFreeMonth={plan.gap?.closed?.debtFreeMonth ?? null} capped={plan.infeasibleFrom != null} />
  );
}
