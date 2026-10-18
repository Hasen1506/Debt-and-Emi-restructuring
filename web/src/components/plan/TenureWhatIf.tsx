'use client';

/**
 * Live test #26: "ask the bank for a longer tenure" as a real what-if.
 *
 * The short-month banner used to give this advice as text only. Here the
 * user picks one EMI loan and how many more months, and the engine re-runs
 * the plan with that loan re-amortised (engine/tenure_whatif.py, the same
 * EMI formula as everywhere else): the new EMI, whether this month's gap
 * closes, and what the extra months cost in interest. Saved only by APPLY
 * TO MY PLAN (founder, 18 Oct 2026), with UNDO.
 */
import { loanMarket } from '@/lib/currency';
import { paymentWords } from '@/lib/terms';
import { engineRequests, isAbortError } from '@/lib/engine-requests';
import { tenureWhatIfCopy } from '@/lib/tenure-whatif-copy';
import { useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { applyTenure, planFigures, recordAppliedChange } from '@/lib/applied-change';
import { AppliedChangeCard } from '@/components/AppliedChangeCard';
import { api, formatCurrencyWhole, type CompareResponse } from '@/lib/api';
import { loanCurrency } from '@/lib/currency';
import { isOpenCurrentLoan } from '@/lib/plan-controls';
import { loanLabel } from '@/lib/loan-types';
import { HORIZON_MONTHS } from '@/lib/horizon';
import { monthIndexToCountryLabel } from '@/lib/today';
import { L_T } from '@/components/ledger/primitives';
import type { PlanData } from './PlanData';

/** The choices offered, in months: one, two, five and ten more years. */
export const TENURE_STEPS = [12, 24, 60, 120] as const;

export const RBI_RESET_CIRCULAR_URL = 'https://www.rbi.org.in/Scripts/NotificationUser.aspx?Id=12529';

export function TenureWhatIf({
  plan,
  onResult,
}: {
  plan: PlanData;
  /** Live test L#26: the what-if's result (with its trajectory), or null
   *  when it's cleared, so the chart and table can show it. */
  onResult?: (r: CompareResponse | null, loanIndex: number, months: number) => void;
}) {
  const user = plan.runArgs?.user ?? plan.user;
  const ccy = plan.displayCurrency;
  const fc = (v: string | number) => formatCurrencyWhole(Math.round(Number(v)), ccy);
  // EMI loans only: a card has no tenure to stretch.
  const options = useMemo(
    () =>
      user.loans
        .map((l, i) => ({ l, i }))
        .filter(({ l }) => isOpenCurrentLoan(l) && l.loan_type !== 'credit_card' && Number(l.scheduled_emi) > 0)
        .sort((a, b) => Number(b.l.scheduled_emi) - Number(a.l.scheduled_emi)),
    [user],
  );
  const [loanIdx, setLoanIdx] = useState<number>(options[0]?.i ?? -1);
  const [months, setMonths] = useState<number>(0);
  const [state, setState] = useState<{ loading: boolean; result: CompareResponse | null; error: string | null }>({
    loading: false,
    result: null,
    error: null,
  });
  const baseKey = JSON.stringify(plan.runArgs ?? null);
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [applyError, setApplyError] = useState<string | null>(null);

  useEffect(() => {
    if (loanIdx < 0 || months <= 0) {
      setState({ loading: false, result: null, error: null });
      return;
    }
    let cancelled = false;
    // NEW-19: a newer choice cancels the run it replaced; an identical run
    // in flight or just answered is shared.
    const controller = new AbortController();
    setState({ loading: true, result: null, error: null });
    const t = setTimeout(async () => {
      try {
        const req = {
          ...(plan.runArgs ?? { user, marginal_rate: plan.marginalRate }),
          strategy: plan.strategy,
          horizon_months: HORIZON_MONTHS,
          tenure_extension_loan_index: loanIdx,
          tenure_extension_months: months,
          include_trajectory: true,
        };
        const r = await engineRequests.run('compare', req, (signal) => api.sensitivity(req, { signal }), controller.signal);
        if (!cancelled) setState({ loading: false, result: r, error: null });
      } catch (e) {
        if (!cancelled && !isAbortError(e)) setState({ loading: false, result: null, error: (e as Error).message });
      }
    }, 300);
    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(t);
    };
    // baseKey stands in for the plan's run settings.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loanIdx, months, baseKey]);

  useEffect(() => {
    onResult?.(state.result, loanIdx, months);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.result]);

  if (options.length === 0) return null;
  const loan = user.loans[loanIdx];
  const lccy = loan ? loanCurrency(loan, user.country) : ccy;
  // R8-2/R8-3: the user's own word for the payment; RBI only for an Indian loan.
  const pw = paymentWords(user.country);
  const inIndia = loan ? loanMarket(loan, user.country) === 'IN' : user.country === 'IN';
  const r = state.result;
  function applyToPlan() {
    if (!r || r.tenure_new_emi == null || !loan) return;
    try {
      const undo = applyTenure({ loanIndex: loanIdx, loanId: loan.id }, months, r.tenure_new_emi);
      const fl = (v: string | number) => formatCurrencyWhole(v, lccy);
      recordAppliedChange({
        country: user.country, currency: ccy === 'USD' ? 'USD' : 'INR',
        what: `${loanLabel(loan)}: ${months / 12} more year${months > 12 ? 's' : ''}, ${pw.one} ${fl(undo.before.emi)} → ${fl(undo.after.emi)}`,
        from: `in your plan from ${monthIndexToCountryLabel(1, user.country)}; at the bank, from the ${pw.one} after they agree`,
        before: planFigures(r, 'baseline'), after: planFigures(r, 'scenario'), bankNote: true, undo,
      });
      setApplyError(null);
      setMonths(0);
      startTransition(() => router.refresh());
    } catch (e) {
      setApplyError((e as Error).message);
    }
  }
  const label = (m: number | null | undefined) =>
    m ? monthIndexToCountryLabel(m, user.country) : 'not within 30 years';
  const when = (m: number | null | undefined, infeasibleFrom: number | null | undefined) =>
    infeasibleFrom != null ? `none, not fundable from ${monthIndexToCountryLabel(infeasibleFrom, user.country)}` : label(m);
  const extraInterest = r ? Number(r.scenario_total_interest ?? 0) - Number(r.baseline_total_interest ?? 0) : 0;
  const gapAfter = r ? Number(r.scenario_shortfall ?? 0) : 0;
  // Live re-test NEW-2: a side that never clears has an unbounded interest
  // total (25-digit figures); never print the difference then.
  const owed = user.loans.reduce((s, l) => s + Math.max(0, Number(l.outstanding) || 0), 0);
  const neverClears =
    !!r &&
    (!!r.baseline_never_clears || !!r.scenario_never_clears ||
      r.baseline_debt_free_month == null || r.scenario_debt_free_month == null ||
      !Number.isFinite(extraInterest) || Math.abs(extraInterest) > Math.max(1, owed) * 100);

  // Live re-test 2 R2-3: no "gap closes" / gap-borrowing reason unless short.
  const copy = r
    ? tenureWhatIfCopy({
        baselineShortfall: Number(r.baseline_shortfall ?? 0),
        scenarioShortfall: gapAfter,
        freed: Number(r.tenure_old_emi ?? 0) - Number(r.tenure_new_emi ?? 0),
        extraInterest,
        neverClears,
        scenarioNeverClears: !!r.scenario_never_clears,
        money: fc,
      })
    : null;

  return (
    <section id="tenure-what-if" data-print="hide" aria-labelledby="tenure-whatif" style={{ border: `1px solid ${L_T.ink}`, padding: '12px 16px', fontSize: 12, lineHeight: 1.7 }}>
      <div id="tenure-whatif" style={{ fontWeight: 700, letterSpacing: '0.08em' }}>
        WHAT IF THE BANK GAVE YOU A LONGER TENURE?
      </div>
      <p style={{ margin: '4px 0 8px', color: L_T.inkSoft }}>
        A longer tenure (more months to repay) lowers the {pw.one}, but you pay interest for longer. Pick a loan and how many
        more months; the plan re-runs with the new {pw.one}, and the chart and table below switch to it (a button there takes
        you back to your plan). Nothing is saved until you press APPLY TO MY PLAN.
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 12px', alignItems: 'center' }}>
        {/* UI revert 2: the card is open again, so at 320px the loan picker
            (label + widest option) was 3px wider than the card; it may now
            shrink to the card's width. */}
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, maxWidth: '100%', minWidth: 0 }}>
          Loan
          <select value={loanIdx} onChange={(e) => setLoanIdx(Number(e.target.value))} aria-label="Loan to stretch" style={{ minWidth: 0, flex: '1 1 auto', maxWidth: '100%' }}>
            {options.map(({ l, i }) => (
              <option key={i} value={i}>
                {loanLabel(l)} · {pw.one === 'EMI' ? 'EMI' : 'Payment'} {formatCurrencyWhole(l.scheduled_emi, loanCurrency(l, user.country))}
              </option>
            ))}
          </select>
        </label>
        <span role="group" aria-label="More months" style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap' }}>
          {TENURE_STEPS.map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={months === m}
              onClick={() => setMonths(months === m ? 0 : m)}
              className="l-hit"
              style={{
                fontFamily: 'inherit',
                fontSize: 11,
                padding: '2px 8px',
                border: `1px solid ${L_T.ink}`,
                background: months === m ? L_T.ink : 'transparent',
                color: months === m ? L_T.bg : L_T.ink,
                cursor: 'pointer',
              }}
            >
              +{m / 12} YR{m > 12 ? 'S' : ''}
            </button>
          ))}
        </span>
      </div>
      <AppliedChangeCard kinds={['tenure']} />
      {state.loading && <p style={{ margin: '8px 0 0', color: L_T.muted }}>Re-running your plan…</p>}
      {state.error && <p role="alert" style={{ margin: '8px 0 0', color: L_T.negative }}>Couldn&apos;t run this: {state.error}</p>}
      {r && r.tenure_new_emi != null && (
        <div role="status" style={{ marginTop: 8 }}>
          {pw.one === 'EMI' ? 'EMI' : 'Monthly payment'} {formatCurrencyWhole(r.tenure_old_emi ?? '0', lccy)} → <strong>{formatCurrencyWhole(r.tenure_new_emi, lccy)}</strong>{' '}
          ({r.tenure_old_months} → {r.tenure_new_months} months left).{' '}
          {copy?.gap ? (
            copy.gapCloses ? <strong style={{ color: L_T.positive }}>{copy.gap}</strong> : <>{copy.gap}</>
          ) : null}{' '}
          {/* Integration phase 5 (C11): a capped side has no date, only the month it stops being fundable. */}
          Debt-free: {when(r.scenario_debt_free_month, r.scenario_infeasible_from_month)} (as things stand: {when(r.baseline_debt_free_month, plan.infeasibleFrom)}).{' '}
          {copy?.interest}
          <span style={{ display: 'block', marginTop: 6 }}>
            <button type="button" className="l-hit" onClick={applyToPlan}
              style={{ fontFamily: 'inherit', fontSize: 11, fontWeight: 700, padding: '4px 10px', border: `1px solid ${L_T.ink}`, background: L_T.ink, color: L_T.bg, cursor: 'pointer' }}>
              APPLY TO MY PLAN
            </button>{' '}
            <span style={{ color: L_T.muted, fontSize: 11 }}>Saves this tenure and {pw.one} on the loan in Profile. Confirm them with your bank.</span>
          </span>
          {applyError && <span role="alert" style={{ display: 'block', color: L_T.negative }}>{applyError}</span>}
        </div>
      )}
      {/* R8-3: RBI's reset rule applies to a loan from an Indian lender only. */}
      {!inIndia ? (
        <p style={{ margin: '8px 0 0', fontSize: 11, color: L_T.muted }}>
          Ask your lender; they decide. A longer term is up to the lender&apos;s own policy and charges, so ask what it
          costs and how it shows on your credit report.
        </p>
      ) : (
      <p style={{ margin: '8px 0 0', fontSize: 11, color: L_T.muted }}>
        Ask your lender; they decide. When a floating rate resets, RBI&apos;s rules say your lender must let you choose a
        higher {pw.one}, a longer tenure or both (
        <a href={RBI_RESET_CIRCULAR_URL} target="_blank" rel="noreferrer">
          RBI circular of 18 Aug 2023, para 2(iii)
        </a>
        ). At other times a longer tenure is up to the lender&apos;s own policy and charges, so ask what it costs and how it
        shows on your credit report.
      </p>
      )}
    </section>
  );
}
