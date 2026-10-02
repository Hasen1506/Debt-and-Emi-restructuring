/**
 * The home page's debt-free date and "this month" move: the same engine
 * run /plan shows, so the two can't disagree. Streamed in (the page wraps these in <Suspense>), so
 * the rest of home paints without waiting on the engine.
 */
import { cache } from 'react';
import Link from 'next/link';
import Decimal from 'decimal.js';
import { loadPlanFromCookies } from '@/components/plan/load-plan';
import { MONTH_NAMES, getCountryToday, monthIndexToCountryLabel, monthsSpan } from '@/lib/today';
import { payThisMonth } from '@/lib/pay-this-month';
import { PayNotice, PayThisMonth } from './PayThisMonth';
import { HomeRestructure } from './HomeRestructure';
import { LBracket } from '@/components/ledger/primitives';
import { thisMonthMove } from '@/lib/this-month';
import { deriveMetrics } from '@/lib/derived';
import { describeGap } from '@/lib/loan-gaps';
import { LOAN_TYPE_NAME } from '@/lib/loan-types';
import { formatCurrencyWhole } from '@/lib/api';
import { fmt as fmtPct } from '@/lib/effective-apr';
import { formatLoanAmount, userDefaultCurrency } from '@/lib/currency';

// One engine run per request, shared by the value and its caption.
const loadPlanOnce = cache(loadPlanFromCookies);

export async function HomeDebtFreeValue() {
  const plan = await loadPlanOnce();
  if (plan.gaps.length > 0 || plan.shortfall > 0 || plan.futureShortfall) return <>NO DATE YET</>;
  if (!plan.live) return <Link href="/plan">SEE PLAN →</Link>;
  // 0 = nothing owed now; null = not cleared within the horizon.
  if (plan.debtFreeMonth === 0) return <>NOW</>;
  if (!plan.debtFreeMonth) return <>NOT ON THIS PLAN</>;
  return <>{monthIndexToCountryLabel(plan.debtFreeMonth, plan.user.country).toUpperCase()}</>;
}

export async function HomeDebtFreeCaption() {
  const plan = await loadPlanOnce();
  if (plan.gaps.length > 0) return <Link href="/profile?step=loans">ADD LOAN DETAILS →</Link>;
  if (plan.futureShortfall) return <Link href="/plan">FUTURE PAYMENTS NEED FUNDING · SEE PLAN →</Link>;
  if (plan.shortfall > 0) {
    return (
      <Link href="/plan">
        SHORT {formatCurrencyWhole(Math.round(plan.shortfall), userDefaultCurrency(plan.user.country))}/MO · PLAN →
      </Link>
    );
  }
  if (!plan.live) return <>DATE + MONTHLY SCHEDULE</>;
  if (plan.debtFreeMonth === 0) return <>NOTHING OWED</>;
  if (!plan.debtFreeMonth) return <Link href="/plan">RAISE SURPLUS · SEE PLAN →</Link>;
  return (
    <Link href="/plan">
      IN {monthsSpan(plan.debtFreeMonth).toUpperCase()}
      {plan.monthsSaved > 0 ? ` · ${monthsSpan(plan.monthsSaved).toUpperCase()} SOONER THAN MINIMUMS` : ''} · PLAN →
    </Link>
  );
}

const PRODUCT: Record<string, string> = {
  credit_card: 'CREDIT CARD',
  personal_loan: 'PERSONAL LOAN',
  home_loan: 'HOME LOAN',
  auto_loan: 'CAR LOAN',
  education_loan: 'EDUCATION LOAN',
  gold_loan: 'GOLD LOAN',
  bnpl: 'BNPL',
};

/** The calm view's one step, from the plan's first month. */
const oneStepWords = cache(async (): Promise<string> => {
  const plan = await loadPlanOnce();
  const profile = { user: plan.user, marginalRate: plan.marginalRate, creditScore: null, isLive: plan.profileIsLive };
  const m = deriveMetrics(profile);
  const fc = (v: number) => formatCurrencyWhole(v, userDefaultCurrency(profile.user.country));
  if (plan.gaps.length > 0) return 'ADD YOUR LOAN DETAILS IN PROFILE.';
  // Short of cash: the engine's gap (costs + minimums − income) when it
  // ran, else the same sum from the profile.
  const short = plan.live ? plan.shortfall : Math.max(0, -Number(m.surplus));
  if (short > 0) return 'PAY AT LEAST THE MINIMUMS. IF YOU CAN’T, CALL THE BANK BEFORE THE DUE DATE.';
  const move = thisMonthMove(plan);
  if (m.surplus.lte(0) || !move) return 'KEEP CURRENT EMIS RUNNING.';
  const first = move.targets[0];
  const loan = first ? profile.user.loans[first.index] : undefined;
  if (first && loan) {
    // In the loan's own currency (₹ for an NRI's Indian loan).
    const amount = formatLoanAmount(first.amount, loan, profile.user.country, plan.fxRatesUsed);
    return `PAY ${amount} EXTRA TO YOUR ${loan.bank ? `${loan.bank.toUpperCase()} ` : ''}${PRODUCT[loan.loan_type] ?? 'LOAN'}.`;
  }
  if (move.ef > 0) return `PUT ${fc(move.ef)} IN YOUR EMERGENCY FUND.`;
  return 'KEEP CURRENT EMIS RUNNING.';
});

export async function HomeMoveOneStep() {
  return <>{await oneStepWords()}</>;
}

/** Why the strategy puts the extra on this loan. */
const REASON: Record<string, (rate: string) => string> = {
  avalanche: (rate) => `it has the highest effective rate, ${rate}`,
  snowball: (rate) => `it's the smallest balance (${rate} effective)`,
  hybrid: (rate) => `your hybrid order puts it first (${rate} effective)`,
};

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
    return (
      <PayNotice title={`Pay this month · ${monthLabel}`}>
        The plan engine can&apos;t be reached right now, so this month&apos;s payments aren&apos;t worked out. Your EMIs
        are due as usual. <LBracket href="/plan">TRY THE PLAN →</LBracket>
      </PayNotice>
    );
  }
  // Why the top extra goes where it does, and what it saves in a year.
  const m = deriveMetrics({ user: plan.user, marginalRate: plan.marginalRate, creditScore: null, isLive: plan.profileIsLive });
  const top = data.rows.find((r) => r.kind === 'extra' || r.kind === 'clears');
  const target = top ? m.loans.find((l) => l.index === top.loanIndex) : undefined;
  const reason =
    top && target
      ? {
          key: top.key,
          text: `The extra goes here: ${(REASON[plan.strategy] ?? REASON.avalanche)(fmtPct(target.effective))}. It saves about ${formatCurrencyWhole(
            Math.round(new Decimal(top.extra).times(target.effective).toNumber()),
            top.currency,
          )} of interest a year.`,
        }
      : undefined;
  const alert =
    plan.shortfall > 0
      ? `Short ${fc(plan.shortfall)} this month: income doesn't cover spending and the minimums below. Pay what you can, and call the bank before the due date.`
      : plan.futureShortfall
        ? `From ${monthIndexToCountryLabel(plan.futureShortfall.month, country)}, the payments need more than you earn. See the plan.`
        : undefined;
  return (
    <PayThisMonth
      data={data}
      loans={plan.user.loans}
      country={country}
      monthLabel={monthLabel}
      reason={reason}
      alert={alert}
    />
  );
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
