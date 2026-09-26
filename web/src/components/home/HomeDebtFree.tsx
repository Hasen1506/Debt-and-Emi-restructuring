/**
 * The home page's debt-free date and "this month" move: the same engine
 * run /plan shows, so the two can't disagree. Streamed in (the page wraps these in <Suspense>), so
 * the rest of home paints without waiting on the engine.
 */
import { cache } from 'react';
import Link from 'next/link';
import Decimal from 'decimal.js';
import { loadPlanFromCookies } from '@/components/plan/load-plan';
import { monthIndexToCountryLabel } from '@/lib/today';
import { thisMonthMove } from '@/lib/this-month';
import { deriveMetrics } from '@/lib/derived';
import { describeGap } from '@/lib/loan-gaps';
import { LOAN_TYPE_NAME } from '@/lib/loan-types';
import { loadProfileServer } from '@/lib/user-store';
import { formatCurrency } from '@/lib/api';
import { fmt as fmtPct } from '@/lib/effective-apr';
import { userDefaultCurrency } from '@/lib/currency';

// One engine run per request, shared by the value and its caption.
const loadPlanOnce = cache(loadPlanFromCookies);

export async function HomeDebtFreeValue() {
  const plan = await loadPlanOnce();
  if (plan.gaps.length > 0 || plan.shortfall > 0) return <>NO DATE YET</>;
  if (!plan.live) return <Link href="/plan">SEE PLAN →</Link>;
  // 0 = nothing owed now; null = not cleared within the horizon.
  if (plan.debtFreeMonth === 0) return <>NOW</>;
  if (!plan.debtFreeMonth) return <>NOT ON THIS PLAN</>;
  return <>{monthIndexToCountryLabel(plan.debtFreeMonth, plan.user.country).toUpperCase()}</>;
}

export async function HomeDebtFreeCaption() {
  const plan = await loadPlanOnce();
  if (plan.gaps.length > 0) return <Link href="/onboarding?step=loans">ADD LOAN DETAILS →</Link>;
  if (plan.shortfall > 0) {
    return (
      <Link href="/plan">
        SHORT {formatCurrency(Math.round(plan.shortfall), userDefaultCurrency(plan.user.country))}/MO · PLAN →
      </Link>
    );
  }
  if (!plan.live) return <>DATE + MONTHLY SCHEDULE</>;
  if (plan.debtFreeMonth === 0) return <>NOTHING OWED</>;
  if (!plan.debtFreeMonth) return <Link href="/plan">RAISE SURPLUS · SEE PLAN →</Link>;
  return (
    <Link href="/plan">
      IN {plan.debtFreeMonth} MONTHS · {plan.monthsSaved > 0 ? `${plan.monthsSaved} SOONER · ` : ''}PLAN →
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

const WHY: Record<string, string> = {
  avalanche: 'HIGHEST EFFECTIVE RATE',
  snowball: 'SMALLEST BALANCE FIRST',
  hybrid: 'YOUR HYBRID ORDER',
};

/** Words for this month's move, from the plan's first month. */
const moveWords = cache(async (): Promise<{ headline: string; detail: string; oneStep: string }> => {
  const [plan, profile] = await Promise.all([loadPlanOnce(), loadProfileServer()]);
  const m = deriveMetrics(profile);
  const fc = (v: number) => formatCurrency(v, userDefaultCurrency(profile.user.country));
  const move = thisMonthMove(plan);
  if (plan.gaps.length > 0) {
    const g = plan.gaps[0];
    return {
      headline: `ADD ${describeGap(g.missing).toUpperCase()} FOR ${(g.loan.bank || 'YOUR').toUpperCase()} ${LOAN_TYPE_NAME[g.loan.loan_type].toUpperCase()}`,
      detail: plan.gaps.length > 1
        ? `${plan.gaps.length} LOANS NEED DETAILS · WITHOUT THEM THE PLAN CAN'T WORK OUT WHAT TO PAY`
        : "WITHOUT IT THE PLAN CAN'T WORK OUT WHAT TO PAY",
      oneStep: 'ADD YOUR LOAN DETAILS IN SETUP.',
    };
  }
  // Short of cash: the engine's gap (costs + minimums − income) when it
  // ran, else the same sum from the profile.
  const short = plan.live ? plan.shortfall : Math.max(0, -Number(m.surplus));
  if (short > 0) {
    return {
      headline: `SHORT ${fc(Math.round(short))}/MO · COSTS + MINIMUM PAYMENTS ARE MORE THAN INCOME`,
      detail: 'CUT COSTS OR ASK THE BANK FOR A LOWER PAYMENT · NO EXTRA PAYMENTS UNTIL THE GAP CLOSES',
      oneStep: 'PAY AT LEAST THE MINIMUMS. IF YOU CAN’T, CALL THE BANK BEFORE THE DUE DATE.',
    };
  }
  if (m.surplus.lte(0)) {
    return {
      headline: 'PAY THE MINIMUMS · NOTHING SPARE THIS MONTH',
      detail: 'INCOME JUST COVERS COSTS AND MINIMUM PAYMENTS',
      oneStep: 'KEEP CURRENT EMIS RUNNING.',
    };
  }
  if (!move) {
    return {
      headline: 'SEE YOUR PLAN FOR THIS MONTH',
      detail: 'THE PLAN ENGINE IS UNREACHABLE RIGHT NOW',
      oneStep: 'KEEP CURRENT EMIS RUNNING.',
    };
  }
  const parts = move.targets.slice(0, 2).map((t) => {
    const loan = profile.user.loans[t.index];
    return `${fc(t.amount)} → ${(loan?.bank || '—').toUpperCase()} ${PRODUCT[loan?.loan_type ?? ''] ?? ''}`.trim();
  });
  if (move.ef > 0) parts.push(`${fc(move.ef)} → EMERGENCY FUND`);
  if (move.goals > 0) parts.push(`${fc(move.goals)} → GOALS`);
  if (parts.length === 0) {
    return {
      headline: `INVEST ${fc(move.surplus)} THIS MONTH`,
      detail: 'NO LOAN COSTS MORE THAN YOUR BEST SAFE RETURN · SEE THE PLAN',
      oneStep: 'KEEP CURRENT EMIS RUNNING.',
    };
  }
  const first = move.targets[0];
  const target = first ? m.loans.find((l) => l.index === first.index) : undefined;
  const saving = target && first
    ? Math.round(new Decimal(first.amount).times(target.effective).toNumber())
    : 0;
  const firstLoan = first ? profile.user.loans[first.index] : undefined;
  return {
    oneStep: first && firstLoan
      ? `PAY ${fc(first.amount)} TO YOUR ${(firstLoan.bank || '').toUpperCase()} ${PRODUCT[firstLoan.loan_type] ?? ''}.`
      : `PUT ${fc(move.ef)} IN YOUR EMERGENCY FUND.`,
    headline: `PAY EXTRA: ${parts.join(' · ')}`,
    detail: target
      ? `${WHY[plan.strategy] ?? 'YOUR PLAN'} · ${fmtPct(target.effective)} · AVOIDS ~${fc(saving)} INTEREST A YEAR`
      : 'BUILDING YOUR EMERGENCY FUND FIRST, AS YOUR PLAN SPLITS IT',
  };
});

export async function HomeMoveHeadline() {
  return <>{(await moveWords()).headline}</>;
}

export async function HomeMoveDetail() {
  return <>{(await moveWords()).detail}</>;
}

export async function HomeMoveOneStep() {
  return <>{(await moveWords()).oneStep}</>;
}
