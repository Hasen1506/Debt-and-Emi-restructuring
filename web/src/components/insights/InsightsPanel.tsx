'use client';

/**
 * The plan-insight cards, first on Setup step 3 and on Home (audit 80+ A1,
 * A5, A6, plus the A4 nudge and "Don't sign that" on Home). Fetched after
 * the page paints, from the same run the plan uses, with what Loan Check
 * last found on this device. If the engine can't answer, nothing is shown
 * and the page works as before.
 */
import { useEffect, useState } from 'react';
import type { Country, LoanPayload, SimulateArgs } from '@/lib/api';
import { formatCurrencyWhole } from '@/lib/api';
import { userDefaultCurrency } from '@/lib/currency';
import { fetchPlanInsights, insightsArgs, type PlanInsights } from '@/lib/insights';
import { readLoanCheckFindings } from '@/lib/loan-check-memory';
import { readLowRateShareClient } from '@/lib/low-rate-choice';
import { LOAN_TYPE_NAME } from '@/lib/loan-types';
import { getCountryToday, monthIndexToCountryLabel } from '@/lib/today';
import { LBracket, L_T } from '@/components/ledger/primitives';
import { DisagreementCard, GapHeadline } from './InsightCards';
import { CheaperWay } from './CheaperWay';
import { OfferCheck } from './OfferCheck';

export function loanName(l: LoanPayload): string {
  return `${l.bank ? `${l.bank} ` : ''}${LOAN_TYPE_NAME[l.loan_type] ?? 'loan'}`;
}

export function InsightsPanel({
  runArgs,
  variant,
  closedDebtFreeMonth,
  onInsights,
}: {
  runArgs: SimulateArgs;
  variant: 'home' | 'setup';
  /** The plan's date if the monthly gap closes (from /simulate's gap_closed). */
  closedDebtFreeMonth?: number | null;
  onInsights?: (i: PlanInsights | null) => void;
}) {
  const country = runArgs.user.country as Country;
  const [data, setData] = useState<PlanInsights | null>(null);
  const year = getCountryToday(country).getFullYear();
  const args = insightsArgs(runArgs, year, { loan_check_findings: undefined });
  const key = JSON.stringify(runArgs);

  useEffect(() => {
    let live = true;
    const findings = readLoanCheckFindings();
    fetchPlanInsights({ ...args, loan_check_findings: findings.length ? findings : undefined })
      .then((d) => {
        if (!live) return;
        setData(d);
        onInsights?.(d);
      })
      .catch(() => {
        if (!live) return;
        setData(null);
        onInsights?.(null);
      });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (!data) return null;
  const ccy = userDefaultCurrency(country);
  const money = (v: number | string) => formatCurrencyWhole(Math.round(Number(v)), ccy);
  const label = (m: number | null) => (m == null ? 'not within the plan' : monthIndexToCountryLabel(m, country));
  const names: Record<number, string> = {};
  runArgs.user.loans.forEach((l, i) => (names[i] = loanName(l)));
  const open = runArgs.user.loans.map((l, i) => ({ l, i })).filter(({ l }) => Number(l.outstanding) > 0);
  const choseLowRate = typeof document !== 'undefined' && readLowRateShareClient() !== '';

  return (
    <div data-testid={`insights-${variant}`} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {data.gap && (
        <GapHeadline
          data={data.gap}
          money={money}
          closedLabel={closedDebtFreeMonth ? monthIndexToCountryLabel(closedDebtFreeMonth, country) : null}
        />
      )}
      <DisagreementCard data={data.disagreements} money={money} compact={variant === 'setup'} />
      {data.consolidation && (
        <CheaperWay
          data={data.consolidation}
          money={money}
          runArgs={variant === 'home' ? args : null}
          cardNames={names}
          dateLabel={label}
        />
      )}
      {variant === 'home' && data.low_rate_phase_month != null && !choseLowRate && (
        <p data-testid="low-rate-nudge" style={{ margin: 0, fontSize: 13, lineHeight: 1.6, color: L_T.inkSoft }}>
          From {label(data.low_rate_phase_month)} only loans under {(Number(data.low_rate_threshold) * 100).toFixed(0)}% a year are
          left. Prepay them, keep the spare cash, or split? <LBracket href="/plan#prepay-keep-split">DECIDE ON PLAN →</LBracket>
        </p>
      )}
      {variant === 'home' && open.length > 0 && (
        <details>
          <summary style={{ cursor: 'pointer', fontSize: 12, letterSpacing: '0.08em', minHeight: 24 }}>
            GOT A TOP-UP, LOAN OR NO-COST EMI OFFER? CHECK IT BEFORE YOU SIGN
          </summary>
          <div style={{ marginTop: 10 }}>
            <OfferCheck runArgs={args} money={money} loanNames={open.map(({ l, i }) => ({ index: i, name: loanName(l) }))} dateLabel={label} />
          </div>
        </details>
      )}
    </div>
  );
}
