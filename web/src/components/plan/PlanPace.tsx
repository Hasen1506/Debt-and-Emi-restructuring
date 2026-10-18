'use client';
/**
 * What actually reached the debts (AUDIT §10 M4), under Plan's date. The
 * plan puts the same total in every month; real months vary. This sets
 * the last three months as logged in Activity beside it, and when the
 * average is off by more than 5%, gives the date at that pace and lets
 * the user make it the plan's total.
 */
import { localTerms } from '@/lib/terms';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { PlanData } from './PlanData';
import { formatCurrencyWhole } from '@/lib/api';
import { loanToUser } from '@/lib/currency';
import { writeDebtBudgetClient } from '@/lib/debt-budget';
import { formatMonth, monthIndexToCountryLabel, monthsSpan } from '@/lib/today';
import { PACE_MIN_MONTHS } from '@/lib/pace';
import { LBracket, L_T } from '@/components/ledger/primitives';

const monthLabel = (m: string) => formatMonth(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1, 'short');

export function PlanPace({ plan }: { plan: PlanData }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const pace = plan.pace;
  if (!pace) return null;
  const ccy = plan.displayCurrency;
  const fc = (v: number) => formatCurrencyWhole(String(Math.round(v)), ccy);
  const avg = pace.average;
  const budget = Number(plan.debtBudget || 0);
  const required = Object.entries(plan.firstMonthMinimums ?? {}).reduce((sum, [i, v]) => {
    const loan = plan.user.loans[Number(i)];
    return loan ? sum + (loanToUser(Number(v), loan, plan.user.country, plan.fxRatesUsed) ?? Number(v)) : sum;
  }, 0);
  const oneOff = pace.months.reduce((s, m) => s + m.oneOff, 0);
  const label = (n: number) => monthIndexToCountryLabel(n, plan.user.country);

  function adoptTotal(v: number) {
    try {
      writeDebtBudgetClient(String(v));
    } catch (e) {
      setError((e as Error).message);
      return;
    }
    setError(null);
    startTransition(() => router.refresh());
  }

  let says: React.ReactNode;
  let actions: React.ReactNode = null;
  if (avg === null) {
    says = (
      <>
        Once two months have every loan&apos;s payment logged, this sets what you paid beside the{' '}
        {fc(pace.planTotal)} a month the plan puts in, and the date at your pace.
      </>
    );
    actions = <LBracket href="/activity">LOG A PAYMENT IN ACTIVITY →</LBracket>;
  } else if (pace.projectionUnavailable) {
    says = (
      <>
        You&apos;ve averaged {fc(avg)} a month over {pace.counted} months.
        {pace.projectionUnavailable === 'below_minimums'
          ? ` That is below this month's ${localTerms('EMIs', plan.user.country)} and minimums (${fc(required)}). The simulator pays those minimums, so it cannot give a payoff date at your lower payments.`
          : pace.projectionUnavailable === 'future_minimums'
            ? localTerms(' Future EMIs and minimums exceed that monthly total.', plan.user.country) + ' The simulator pays them, so it cannot give a payoff date at your lower payments.'
          : pace.projectionUnavailable === 'unaffordable'
            ? " That's more than your take-home leaves after spending in some months, as Profile has them. If you keep paying it, your take-home is higher or your spending lower than Profile says: update them, and the date follows."
            : ' The pace projection could not be calculated. Try refreshing the plan.'}
      </>
    );
    actions = <LBracket href="/profile?step=income">UPDATE SPENDING AND TAKE-HOME →</LBracket>;
  } else if (!pace.differs) {
    says = (
      <>
        You&apos;ve averaged {fc(avg)} a month over {pace.counted} months, in line with the {fc(pace.planTotal)} this plan
        puts in. The displayed date uses that planned total.
      </>
    );
  } else if (avg < pace.planTotal) {
    const later = pace.debtFreeMonth && plan.debtFreeMonth ? pace.debtFreeMonth - plan.debtFreeMonth : null;
    says = (
      <>
        You&apos;ve averaged {fc(avg)} a month over {pace.counted} months; this plan puts in {fc(pace.planTotal)}.{' '}
        {pace.debtFreeMonth ? (
          <>
            At {fc(avg)} a month you&apos;d be debt-free in <b>{label(pace.debtFreeMonth)}</b>
            {later && later > 0 ? <>, {monthsSpan(later)} later</> : null}.
          </>
        ) : (
          <>At {fc(avg)} a month the debts wouldn&apos;t clear within the plan.</>
        )}{' '}
        {avg < required - 1
          ? localTerms(`That's under this month's EMIs and minimums (${fc(required)}): some were paid short.`, plan.user.country)
          : 'Paying less than planned usually means spending ran over what Profile says. Make the plan the total you keep up, or update your spending.'}
      </>
    );
    actions = (
      <>
        {avg >= required - 1 && (
          <LBracket active onClick={() => adoptTotal(avg)} label={pending ? 'Working it out' : `Use ${fc(avg)} a month as the plan's total to debts`}>
            {pending ? 'WORKING IT OUT…' : `USE ${fc(avg)} A MONTH`}
          </LBracket>
        )}
        <LBracket href="/profile?step=income">UPDATE SPENDING →</LBracket>
      </>
    );
  } else {
    const sooner = pace.debtFreeMonth && plan.debtFreeMonth ? plan.debtFreeMonth - pace.debtFreeMonth : null;
    says = (
      <>
        You&apos;ve averaged {fc(avg)} a month over {pace.counted} months, more than the {fc(pace.planTotal)} this plan
        puts in.{' '}
        {budget > 0 && avg > budget
          ? sooner && sooner > 0
            ? <>At that pace you&apos;d be debt-free in <b>{label(pace.debtFreeMonth!)}</b>, {monthsSpan(sooner)} sooner.</>
            : 'Your set total is lower than what you pay.'
          : 'Your spending may be lower, or your take-home higher, than Profile says.'}
      </>
    );
    actions =
      budget > 0 && avg > budget ? (
        <LBracket active onClick={() => adoptTotal(avg)} label={pending ? 'Working it out' : `Raise my total to ${fc(avg)} a month: the plan's total to debts`}>
          {pending ? 'WORKING IT OUT…' : `RAISE MY TOTAL TO ${fc(avg)}`}
        </LBracket>
      ) : (
        <LBracket href="/profile?step=income">UPDATE PROFILE →</LBracket>
      );
  }

  return (
    <section aria-labelledby="plan-pace-h" style={{ fontSize: 12, lineHeight: 1.6 }}>
      <div id="plan-pace-h" style={{ fontWeight: 700, letterSpacing: '0.1em', fontSize: 11 }}>
        WHAT YOU&apos;VE PAID
        <span style={{ fontWeight: 400, color: L_T.muted }}> · LAST {pace.months.length} MONTHS, FROM ACTIVITY</span>
      </div>
      <ol
        aria-label="Paid to debts each month"
        style={{ listStyle: 'none', margin: '8px 0', padding: '6px 0', display: 'flex', gap: 16, flexWrap: 'wrap', borderTop: `1px solid ${L_T.ink}`, borderBottom: `1px dashed ${L_T.ruleSoft}` }}
      >
        {pace.months.map((m) => (
          <li key={m.month} style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontSize: 10, letterSpacing: '0.1em', color: L_T.muted }}>{monthLabel(m.month)}</span>
            <span style={{ fontWeight: 700, color: m.complete ? L_T.ink : L_T.muted }}>
              {m.paid > 0 ? fc(m.paid) : '—'}
            </span>
            {!m.complete && (
              <span style={{ fontSize: 10, letterSpacing: '0.06em', color: L_T.muted }}>
                {m.paid > 0 || m.oneOff > 0 ? 'NOT ALL LOGGED' : 'NOTHING LOGGED'}
              </span>
            )}
          </li>
        ))}
        <li style={{ display: 'flex', flexDirection: 'column' }}>
          <span style={{ fontSize: 10, letterSpacing: '0.1em', color: L_T.muted }}>PLAN</span>
          <span style={{ fontWeight: 700 }}>{fc(pace.planTotal)}</span>
          <span style={{ fontSize: 10, letterSpacing: '0.06em', color: L_T.muted }}>A MONTH</span>
        </li>
      </ol>
      <p style={{ margin: 0, color: L_T.inkSoft }}>{says}</p>
      {oneOff > 0 && (
        <p style={{ margin: '6px 0 0', color: L_T.muted }}>
          Plus {fc(oneOff)} in one-off payments (a bonus, a sale, a loan closed). They&apos;re off your balances
          already, and aren&apos;t counted as a monthly pace.
        </p>
      )}
      {avg !== null && pace.counted < pace.months.length && (
        <p style={{ margin: '6px 0 0', color: L_T.muted }}>
          A month counts once every loan&apos;s payment is logged; {pace.months.length - pace.counted} of {pace.months.length}{' '}
          aren&apos;t, so the average is over {pace.counted} (at least {PACE_MIN_MONTHS} are needed).
        </p>
      )}
      {actions && <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 8 }}>{actions}</div>}
      {error && (
        <p role="alert" style={{ margin: '6px 0 0', color: L_T.negative }}>
          {error}
        </p>
      )}
    </section>
  );
}
