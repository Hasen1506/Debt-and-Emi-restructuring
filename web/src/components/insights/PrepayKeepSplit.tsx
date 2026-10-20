'use client';

/**
 * Audit 80+ A4 + D1: once every loan left costs less after tax than the
 * user's own assumed return + 1 point (round 2; default 6.5% IN / 4% US,
 * editable on Plan) and the emergency fund is full, the plan
 * stops and asks: prepay, keep the money, or split. No default. Each option
 * is shown with its debt-free date and the money in hand on ONE common date
 * (the day the slowest option clears), at a yearly return the user types
 * themselves; the break-even return is the honest core. Nothing here names
 * an investment, a kind of investment, or tells anyone to invest.
 */
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { LButton, L_T, LSectionHeader, lStrip } from '@/components/ledger/primitives';
import { fetchPrepayInvest, type InsightsArgs, type PrepayInvestData } from '@/lib/insights';
import { formatCurrencyWhole, type Country } from '@/lib/api';
import { thresholdWords } from '@/lib/plan-inputs';
import { userDefaultCurrency } from '@/lib/currency';
import { getCountryToday, monthIndexToCountryLabel } from '@/lib/today';
import {
  readAssumedReturn, readLowRateShareClient, shareWords, writeAssumedReturn, writeLowRateShareClient,
} from '@/lib/low-rate-choice';

type Money = (v: number | string) => string;

export const PREPAY_KEEP_NOTE =
  'This compares the numbers at a return you type; it isn’t advice to buy any investment. Prepaying earns exactly what the loan costs, for certain; a return isn’t certain, and money kept back stays yours to use.';

export function PrepayKeepSplit({ runArgs: plain }: { runArgs: InsightsArgs }) {
  const country = plain.user.country as Country;
  const runArgs: InsightsArgs = { ...plain, simulation_start_year: getCountryToday(country).getFullYear() };
  const money: Money = (v) => formatCurrencyWhole(Math.round(Number(v)), userDefaultCurrency(country));
  const dateLabel = (m: number | null) => (m == null ? 'not within the plan' : monthIndexToCountryLabel(m, country));
  const router = useRouter();
  const [data, setData] = useState<PrepayInvestData | null>(null);
  const [ret, setRet] = useState('');
  const [chosen, setChosen] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const argsKey = JSON.stringify(runArgs);
  const req = useRef(0);

  async function load(r: string) {
    // Only the latest request may write: an older, slower reply was drawn over a newer one.
    const id = ++req.current;
    setBusy(true);
    setErr(null);
    try {
      // The comparison always starts from "prepay everything" (the share the
      // plan runs with is the user's own choice, compared against the rest).
      const base = { ...runArgs, low_rate_invest_share: undefined };
      const d = await fetchPrepayInvest(r ? { ...base, assumed_return: r } : base);
      if (id === req.current) setData(d);
    } catch (e) {
      if (id === req.current) setErr((e as Error).message);
    } finally {
      if (id === req.current) setBusy(false);
    }
  }

  useEffect(() => {
    const saved = readAssumedReturn();
    setRet(saved ? String(+(Number(saved) * 100).toFixed(2)) : '');
    setChosen(readLowRateShareClient());
    void load(saved);
    return () => { req.current++; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [argsKey]);

  if (!data || !data.available) return null;

  function compare() {
    const n = ret.trim() === '' ? null : Number(ret);
    if (n !== null && !(n >= 0 && n <= 30)) {
      setErr('Enter a yearly return between 0% and 30%.');
      return;
    }
    const v = n === null ? '' : (n / 100).toFixed(4);
    writeAssumedReturn(v);
    void load(v);
  }

  function choose(share: string) {
    writeLowRateShareClient(share);
    setChosen(share);
    router.refresh();
  }

  const loans = data.phase_loans.length;
  const be = data.break_even_return ? `${(Number(data.break_even_return) * 100).toFixed(1)}%` : null;
  return (
    <section aria-labelledby="pks-h" data-testid="prepay-keep-split" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <LSectionHeader>
        <span id="pks-h">From {dateLabel(data.phase_month)}: prepay, keep, or split?</span>
      </LSectionHeader>
      <p style={{ margin: 0, fontSize: 12, lineHeight: 1.6 }}>
        By {dateLabel(data.phase_month)} only {loans === 1 ? 'one loan' : `${loans} loans`} costing under{' '}
        <span data-testid="pks-threshold">{thresholdWords(data.threshold, data.assumed_return_for_trigger, data.assumption_is_default)}</span>{' '}
        {loans === 1 ? 'is' : 'are'} left, and about{' '}
        {money(data.extra_then ?? 0)} a month spare. Whether that goes to the loan is your call: the plan doesn’t pick.
      </p>
      <p data-testid="pks-statement" style={{ margin: 0, padding: '10px 12px', background: L_T.paper, border: `1px solid ${L_T.ruleSoft}`, fontSize: 12, lineHeight: 1.55, ...lStrip('ink') }}>
        {data.statement}
        {be && !data.assumed_return && <> Break-even: <strong>{be}</strong> a year after tax.</>}
      </p>
      <label style={{ fontSize: 11, display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        To see money in hand, type the yearly return after tax you want to compare with (%)
        <input
          inputMode="decimal"
          aria-label="Yearly return after tax, %"
          value={ret}
          onChange={(e) => setRet(e.target.value.replace(/[^\d.]/g, ''))}
          style={{ width: 80, padding: '4px 6px', border: `1px solid ${L_T.ink}`, fontFamily: 'inherit', fontSize: 13 }}
        />
        <LButton onClick={compare} disabled={busy}>{busy ? 'WORKING…' : 'COMPARE'}</LButton>
      </label>
      {err && <p role="alert" style={{ margin: 0, fontSize: 11, color: L_T.negative }}>{err}</p>}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, minWidth: 300 }}>
          <caption style={{ textAlign: 'left', fontSize: 11, color: L_T.muted, paddingBottom: 4 }}>
            Every option valued on {dateLabel(data.common_month)}, the day the slowest one clears
          </caption>
          <thead>
            <tr style={{ textAlign: 'left', color: L_T.muted }}>
              <th scope="col" style={{ padding: '4px 6px 4px 0', fontWeight: 500 }}>With the spare cash</th>
              <th scope="col" style={{ padding: '4px 6px', fontWeight: 500 }}>Debt-free</th>
              <th scope="col" style={{ padding: '4px 6px', fontWeight: 500 }}>Money in hand</th>
              <th scope="col" style={{ padding: '4px 0', fontWeight: 500 }}><span className="sr-only">Choose</span></th>
            </tr>
          </thead>
          <tbody>
            {data.options.map((o) => {
              const on = chosen !== '' && Number(chosen) === Number(o.share_kept);
              return (
                <tr key={o.share_kept} data-testid={`pks-row-${o.share_kept}`} style={{ borderTop: `1px dashed ${L_T.ruleSoft}`, background: on ? L_T.highlightSoft : undefined }}>
                  <th scope="row" style={{ padding: '8px 6px 8px 0', fontWeight: on ? 700 : 500, textAlign: 'left' }}>{shareWords(o.share_kept)}</th>
                  <td style={{ padding: '8px 6px', whiteSpace: 'nowrap' }}>{dateLabel(o.debt_free_month)}</td>
                  <td style={{ padding: '8px 6px', whiteSpace: 'nowrap' }}>{o.money_on_common_date == null ? '—' : money(o.money_on_common_date)}</td>
                  <td style={{ padding: '8px 0' }}>
                    {on ? (
                      <span style={{ fontSize: 11, color: L_T.positive }}>YOUR CHOICE</span>
                    ) : (
                      <button type="button" onClick={() => choose(String(Number(o.share_kept)))} style={{ minHeight: 32, padding: '4px 10px', border: `1px solid ${L_T.ink}`, background: L_T.paper, fontFamily: 'inherit', fontSize: 11, cursor: 'pointer' }}>
                        CHOOSE
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p style={{ margin: 0, fontSize: 11, color: L_T.muted, lineHeight: 1.5 }}>
        {chosen === '' ? 'Until you choose, the plan keeps prepaying. ' : ''}
        {PREPAY_KEEP_NOTE}
      </p>
    </section>
  );
}
