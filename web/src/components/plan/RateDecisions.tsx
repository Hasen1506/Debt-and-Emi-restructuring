'use client';
/**
 * The next RBI or Fed decision, loan by loan (AUDIT §10 M5): what a
 * quarter-point move does to each loan that follows it, from when, and
 * whether there's anything to wait for. Replaces the one-line central
 * bank note, which told everyone near a meeting to hold off on a
 * prepayment (a prepayment saves interest from the day it's made,
 * whatever the rate becomes).
 */
import { localTerms } from '@/lib/terms';
import { useEffect, useState } from 'react';
import type { PlanData } from './PlanData';
import { api, formatCurrencyWhole, type CentralRatesResponse, type LoanPayload, type Country } from '@/lib/api';
import { formatAsOf } from '@/lib/as-of';
import { loanCurrency, loanMarket } from '@/lib/currency';
import { loanLabel, loanName } from '@/lib/loan-types';
import { isOpenCurrentLoan } from '@/lib/plan-controls';
import { RATE_STEP, dayLabel, followsCentralBank, rateMove, whenItApplies, type RateMove } from '@/lib/rate-decision';
import { monthsSpan } from '@/lib/today';
import { L_T } from '@/components/ledger/primitives';
import { isAbortError } from '@/lib/engine-requests';

const STEP = `${(RATE_STEP * 100).toFixed(2)}%`;

export function RateDecisions({ plan }: { plan: PlanData }) {
  const country = plan.user.country;
  const loans = plan.user.loans.filter(isOpenCurrentLoan);
  const [data, setData] = useState<CentralRatesResponse | null>(null);
  useEffect(() => {
    // Re-test 9 O-1: WebKit logged an error when this request was cut off
    // by a navigation. Leaving the page (or this view) now aborts it, and an
    // aborted request is dropped quietly: it isn't an error.
    const ctrl = new AbortController();
    const stop = () => ctrl.abort();
    window.addEventListener('pagehide', stop);
    api
      .centralRates(ctrl.signal)
      .then((res) => !ctrl.signal.aborted && setData(res))
      .catch((e: unknown) => {
        if (ctrl.signal.aborted || isAbortError(e)) return;
        /* otherwise said without the date */
      });
    return () => {
      window.removeEventListener('pagehide', stop);
      ctrl.abort();
    };
  }, []);
  if (loans.length === 0) return null;

  const markets = [...new Set(loans.map(l => loanMarket(l, country)))];
  return <div id="rate-decisions">{markets.map(market => (
    <RateDecisionMarket key={market} country={market} loans={loans.filter(l => loanMarket(l, country) === market)} data={data} />
  ))}</div>;
}

function RateDecisionMarket({ country, loans, data }: { country: Country; loans: LoanPayload[]; data: CentralRatesResponse | null }) {

  const slice = data?.[country];
  const bank = country === 'IN' ? 'RBI' : 'THE FED';
  const rateName = country === 'IN' ? 'REPO' : 'FED FUNDS';
  const decision = slice?.next_meeting_date ?? null;
  const days = slice?.days_until_next;
  const moves = loans.map((l) => rateMove(l, country)).filter((m): m is RateMove => m !== null);
  const still = loans.filter((l) => !followsCentralBank(l, country));
  const fc = (v: number, l: LoanPayload) => formatCurrencyWhole(String(Math.round(v)), loanCurrency(l, country));

  return (
    <section aria-labelledby={`rate-decisions-${country}-h`} style={{ fontSize: 12, lineHeight: 1.6, scrollMarginTop: 16 }}>
      <div id={`rate-decisions-${country}-h`} style={{ fontWeight: 700, letterSpacing: '0.1em', fontSize: 11 }}>
        IF {bank} MOVES RATES
        <span style={{ fontWeight: 400, color: L_T.muted }}>
          {slice && ` · ${rateName} ${(Number(slice.current_rate) * 100).toFixed(2)}% (AS OF ${formatAsOf(slice.as_of).toUpperCase()})`}
          {decision && ` · NEXT DECISION ${dayLabel(decision).toUpperCase()}`}
          {days != null && days >= 0 && days <= 14 && (
            <span style={{ color: L_T.ink, fontWeight: 700 }}> · IN {days} DAY{days === 1 ? '' : 'S'}</span>
          )}
        </span>
      </div>
      <ul style={{ listStyle: 'none', margin: '8px 0 0', padding: 0, borderTop: `1px solid ${L_T.ink}` }}>
        {moves.map((m) => (
          <li key={m.loan.id ?? loanLabel(m.loan)} style={{ padding: '10px 0', borderBottom: `1px dashed ${L_T.ruleSoft}` }}>
            <div style={{ fontWeight: 700 }}>
              {loanLabel(m.loan)}
              <span style={{ fontWeight: 400, fontSize: 10, letterSpacing: '0.1em', color: L_T.muted }}>
                {' '}· {m.follows === 'card' ? 'VARIABLE APR' : 'FLOATING'}
                {m.follows === 'floating' && m.loan.rate_type_assumed === true ? ' (ASSUMED: CHECK YOUR LOAN LETTER)' : ''}
              </span>
            </div>
            <div style={{ color: L_T.inkSoft }}>{moveWords(m, fc, country)}</div>
            <div style={{ color: L_T.muted }}>
              {whenItApplies(m, country, decision).replace(/^./, (c) => c.toUpperCase())}.
            </div>
          </li>
        ))}
        {still.length > 0 && (
          <li style={{ padding: '10px 0', borderBottom: `1px dashed ${L_T.ruleSoft}`, color: L_T.inkSoft }}>
            <b>{still.map((l, i) => (i === 0 ? loanLabel(l) : loanName(l))).join(', ')}</b>: {still.length === 1 ? "a decision doesn't change it" : "a decision doesn't change these"}
            {country === 'IN' && still.some((l) => l.loan_type === 'credit_card')
              ? " (fixed rates; card rates in India aren't linked to the repo rate)."
              : ' (fixed rates).'}
          </li>
        )}
      </ul>
      <p style={{ margin: '8px 0 0', color: L_T.inkSoft }}>
        <b>Do you need to wait?</b>{' '}
        {country === 'IN'
          ? "Not for the loans you have: the bank passes a benchmark change on at the reset. A prepayment reduces the balance charged interest; check its fees in your loan terms. A decision matters when you take a new loan or switch one: a fixed rate is set on the day you sign, a floating one follows later decisions."
          : "Not for the loans you have: fixed ones don't move, and a variable one follows its benchmark. Paying a card down reduces the balance charged interest. A decision matters for a new loan or a refinance; mortgage rates also follow Treasury yields and expected decisions may already be priced in."}
      </p>
    </section>
  );
}

function moveWords(m: RateMove, fc: (v: number, l: LoanPayload) => string, country?: string): string {
  const l = m.loan;
  if (m.follows === 'card') {
    return `A ${STEP} rise adds about ${fc(m.interestUp ?? 0, l)} a month in interest on today's balance; a cut takes about that off.`;
  }
  const { months, emi } = m;
  const more = months?.now != null && months.up != null ? months.up - months.now : null;
  const fewer = months?.now != null && months.down != null ? months.now - months.down : null;
  const emiUp = emi ? fc(emi.up - emi.now, l) : null;
  const emiDown = emi ? fc(emi.now - emi.down, l) : null;
  const rise =
    more != null && more > 0
      ? `A ${STEP} rise: ${monthsSpan(more)} more at the same ${fc(Number(l.scheduled_emi), l)} EMI (what banks usually do)${emiUp ? `, or ${emiUp} more a month if you ask to keep the months` : ''}.`
      : months && months.up == null
        ? localTerms(`A ${STEP} rise would leave the EMI short of the interest: ask the bank to raise it.`, country)
        : emiUp
          ? `A ${STEP} rise: about ${emiUp} more a month.`
          : '';
  const cut =
    fewer != null && fewer > 0
      ? ` A ${STEP} cut: ${monthsSpan(fewer)} fewer${emiDown ? `, or ${emiDown} less a month` : ''}.`
      : emiDown
        ? ` A ${STEP} cut: about ${emiDown} less a month.`
        : '';
  return `${rise}${cut}`.trim();
}
