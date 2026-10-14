'use client';

/** UX50 B-11: Home's one-line "this month" instruction (the words come from
 *  lib/home-this-month, worked out on the server). Re-test 9 O-3: once
 *  payments are logged this month, it says what's paid and what's left
 *  (lib/this-month-progress), read the same way as the list below. */
import { useEffect, useState } from 'react';
import { LBracket, L_T, lStrip } from '@/components/ledger/primitives';
import type { ThisMonthLine } from '@/lib/home-this-month';
import type { Country, LoanPayload } from '@/lib/api';
import { formatCurrencyWhole } from '@/lib/api';
import { readActivityClient } from '@/lib/activity';
import { alignToLoans } from '@/lib/loan-ids';
import { userDefaultCurrency } from '@/lib/currency';
import { getCountryToday, localIsoDate } from '@/lib/today';
import type { PayRow } from '@/lib/pay-this-month';
import { SET_ASIDE_EVENT, SET_ASIDE_KEY, progressLine, thisMonthProgress } from '@/lib/this-month-progress';

export interface ThisMonthProgressInput {
  rows: Pick<PayRow, 'key' | 'loanIndex' | 'minimum' | 'amount' | 'amountUser'>[];
  loans: LoanPayload[];
  country: Country;
  total: number;
}

export function HomeThisMonth({ line, progress }: { line: ThisMonthLine; progress?: ThisMonthProgressInput }) {
  const [text, setText] = useState(line.text);
  useEffect(() => {
    if (!progress || line.tone === 'short') return;
    const { rows, loans, country, total } = progress;
    const money = (v: number) => formatCurrencyWhole(Math.round(v), userDefaultCurrency(country));
    const read = () => {
      const month = localIsoDate(getCountryToday(country)).slice(0, 7);
      let ticked: string[] = [];
      try {
        const t = JSON.parse(window.localStorage.getItem(SET_ASIDE_KEY) || 'null');
        ticked = t && t.month === month && Array.isArray(t.keys) ? t.keys : [];
      } catch {
        ticked = [];
      }
      const p = thisMonthProgress(rows, alignToLoans(readActivityClient(), loans), ticked, month);
      setText(progressLine(p, total, money, line.text));
    };
    read();
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'rightdue_activity' || e.key === SET_ASIDE_KEY) read();
    };
    window.addEventListener('storage', onStorage);
    window.addEventListener('rightdue:profile-changed', read);
    window.addEventListener(SET_ASIDE_EVENT, read);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('rightdue:profile-changed', read);
      window.removeEventListener(SET_ASIDE_EVENT, read);
    };
  }, [line, progress]);
  return (
    <section
      aria-label="This month"
      data-testid="home-this-month"
      style={{ padding: '12px 14px', background: L_T.paper, border: `1px solid ${L_T.ruleSoft}`, ...lStrip(line.tone === 'short' ? 'negative' : 'accent') }}
    >
      <div style={{ fontSize: 11, letterSpacing: '0.12em', color: L_T.muted, marginBottom: 4 }}>THIS MONTH</div>
      <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5 }}>
        {text} <LBracket href="#home-pay">{line.link}</LBracket>
      </p>
    </section>
  );
}
