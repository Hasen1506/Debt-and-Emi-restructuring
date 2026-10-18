'use client';

/**
 * Audit 80+ A6: "Cheaper way to carry this" for a revolving card that costs
 * over 30% a year. The engine prices the move at the user's own quote, or at
 * the rates banks actually charged last quarter (typical and high, never a
 * bank's floor), counts the fee and its GST, and runs both versions of the
 * user's plan (engine/consolidation.py). No lender is named or paid.
 */
import { useState } from 'react';
import { LBracket, LButton, LChip, LChipRow, L_T, LSectionHeader, lStrip } from '@/components/ledger/primitives';
import { fetchConsolidation, type ConsolidationData, type ConsolidationScenario, type InsightsArgs } from '@/lib/insights';

type Money = (v: number | string) => string;

const BASIS: Record<ConsolidationScenario['rate_basis'], string> = {
  yours: 'Your quote',
  typical: 'Typical (middle of banks’ averages)',
  high: 'High (middle of banks’ maximums)',
};

/** How a card-to-loan move works in India, with its sources (audit 80+ A6; Vijay: "explain it in-app"). */
export const CONSOLIDATION_EXPLAINER: { text: string; source?: { label: string; url: string } }[] = [
  { text: 'No bank “moves” a card balance. You take a new loan (a personal loan, a loan on your card from the same bank, or a top-up on a home loan) and use it to pay the card in full. Some banks also offer a card-to-card balance transfer: a lower rate for a few months, for a fee.' },
  {
    text: 'Why it can cost less: card interest compounds every month and has 18% GST added; interest on a loan has no GST, and the EMI ends on a fixed date.',
    source: { label: 'CBIC GST rates (Notifications 11/2017 and 12/2017-CT(Rate))', url: 'https://cbic-gst.gov.in/gst-goods-services-rates.html' },
  },
  { text: 'What it costs: a processing fee, with 18% GST on the fee. Here the loan is sized so the card is cleared in full after both.' },
  {
    text: 'Paying it off early: a floating-rate loan to an individual (not for business) carries no prepayment or foreclosure charge. A fixed-rate personal loan may; the charge is in its Key Facts Statement.',
    source: { label: 'RBI (Pre-payment Charges on Loans) Directions, 2 July 2025', url: 'https://www.rbi.org.in/Scripts/NotificationUser.aspx?Id=12878&Mode=0' },
  },
  {
    text: 'Before you sign: the lender must give you a Key Facts Statement with the APR (interest plus every charge), valid for at least three working days, so you can compare it with these figures.',
    source: { label: 'RBI Key Facts Statement circular, 15 Apr 2024', url: 'https://www.rbi.org.in/Scripts/NotificationUser.aspx?Id=12663' },
  },
  {
    text: 'Your credit score: each application is a hard enquiry, and several in a short time can lower the score. Paying the card down lowers how much of your card limit you use, which helps it.',
    source: { label: 'TransUnion CIBIL score brochure, Oct 2025', url: 'https://www.cibil.com/content/dam/cibil/consumer/cibil-score-and-report-brochure-15-10-25.pdf' },
  },
  { text: 'The trap: the card stays open. If it fills up again you owe the loan and the card. Keep using it only for what you clear in full each month.' },
];

function pct(v: string | number, dp = 1): string {
  return `${(Number(v) * 100).toFixed(dp)}%`;
}

/** UX walkthrough fix 1: when the plan makes the move pointless (it clears
 *  the cards within two months) or it saves nothing, one quiet line instead
 *  of a pitch, so it can't contradict the plan or "Cheaper rates". */
export function notWorthLine(data: ConsolidationData, cards: string, dateLabel: (m: number | null) => string): string | null {
  const them = data.cards.length > 1 ? 'them' : 'it';
  if (data.not_worth_it === 'plan_clears')
    return `Moving your ${cards} to a personal loan isn't worth it: your plan clears ${them} by ${dateLabel(data.plan_clears_month ?? null)}, before a new loan would go through.`;
  // UX2B-12: a pay or loan size banks usually turn down, or payments already near their limit.
  if (data.not_worth_it === 'not_approvable')
    return `A personal loan to clear your ${cards} is unlikely to be approved on this income and these payments, so your plan keeps paying ${them} down. If a lender offers you one, enter its rate to compare.`;
  if (data.not_worth_it === 'costs_more')
    return `Moving your ${cards} to a personal loan wouldn't save money at these rates, so your plan keeps paying ${them} down.`;
  return null;
}

export function CheaperWay({
  data: initial,
  money,
  runArgs,
  cardNames,
  dateLabel,
  country = 'IN',
}: {
  data: ConsolidationData;
  money: Money;
  /** The plan's own run, to re-price at the user's quote. */
  runArgs?: InsightsArgs | null;
  cardNames: Record<number, string>;
  dateLabel: (m: number | null) => string;
  /** UX walkthrough fix 5: GST, RBI and Indian loan words only in India. */
  country?: 'IN' | 'US';
}) {
  const [data, setData] = useState(initial);
  const [rate, setRate] = useState('');
  const [tenure, setTenure] = useState(initial.scenarios[0]?.tenure_months ?? 36);
  const [fee, setFee] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const cards = data.cards.map((i) => cardNames[i] ?? 'your card').join(' and ');
  const cost = data.cards.map((i) => Number(data.card_cost[String(i)] ?? 0));
  const india = country === 'IN';

  async function requote(nextTenure = tenure) {
    if (!runArgs) return;
    setErr(null);
    const r = rate.trim() ? Number(rate) / 100 : null;
    if (r !== null && !(r >= 0.05 && r <= 0.4)) {
      setErr('Enter a quote between 5% and 40% a year.');
      return;
    }
    const f = fee.trim() ? Number(fee) / 100 : 0;
    if (!(f >= 0 && f <= 0.05)) {
      setErr('Enter a processing fee between 0% and 5%.');
      return;
    }
    setBusy(true);
    try {
      const next = await fetchConsolidation({
        ...runArgs,
        consolidation_rate: r === null ? undefined : r.toFixed(4),
        consolidation_tenure_months: nextTenure,
        consolidation_fee_pct: f.toFixed(4),
      });
      if (next) setData(next);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const quiet = notWorthLine(data, cards, dateLabel);
  if (quiet)
    return (
      <p data-testid="cheaper-way-not-worth" style={{ margin: 0, fontSize: 11, lineHeight: 1.6, color: L_T.muted }}>
        {quiet}
      </p>
    );
  return (
    <section aria-labelledby="cheaper-h" data-testid="cheaper-way" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <LSectionHeader>
        <span id="cheaper-h">Cheaper way to carry this</span>
      </LSectionHeader>
      <p style={{ margin: 0, fontSize: 12, lineHeight: 1.6 }}>
        Your {cards} {data.cards.length > 1 ? 'cost' : 'costs'}{' '}
        <strong>{cost.map((c) => pct(c)).join(' and ')} a year</strong> (interest compounded monthly{india ? ', plus 18% GST' : ''}). Here is
        the same balance as a {india ? 'fixed-EMI' : 'fixed-payment'} personal loan, on your own plan:
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {data.scenarios.map((s) => (
          <div
            key={`${s.rate_basis}-${s.rate}`}
            data-testid={`cheaper-scenario-${s.rate_basis}`}
            style={{ padding: '10px 12px', background: L_T.paper, border: `1px solid ${L_T.ruleSoft}`, ...lStrip(Number(s.saving) > 0 ? 'positive' : 'negative') }}
          >
            <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', letterSpacing: '0.1em', color: L_T.muted }}>
              {BASIS[s.rate_basis].toUpperCase()} · {pct(s.rate)} · {s.tenure_months} MONTHS
            </div>
            <ul style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: 12, lineHeight: 1.55 }}>
              <li>
                {india ? 'EMI' : 'Payment'} <strong>{money(s.emi)}</strong> a month, against a card minimum of {money(s.card_minimum_now)}:{' '}
                {Number(s.cash_freed) >= 0 ? (
                  <strong style={{ color: L_T.positive }}>{money(s.cash_freed)} a month freed</strong>
                ) : (
                  <strong style={{ color: L_T.negative }}>{money(-Number(s.cash_freed))} a month more</strong>
                )}
                .
              </li>
              {Number(s.gap_before) > 0 && (
                <li>
                  Your monthly gap goes from {money(s.gap_before)} to <strong>{money(s.gap_after)}</strong>.
                </li>
              )}
              <li>
                {Number(s.saving) > 0 ? 'Saves ' : 'Costs '}
                <strong>{money(Math.abs(Number(s.saving)))}</strong>
                {s.cost_window_months ? ` over the next ${s.cost_window_months} months` : ' over your plan'}, with the{' '}
                {india
                  ? Number(s.fee) > 0 ? `${money(Number(s.fee) + Number(s.fee_gst))} fee and GST` : 'fee and GST (none entered)'
                  : Number(s.fee) > 0 ? `${money(Number(s.fee))} fee` : 'fee (none entered)'}{' '}
                counted.
              </li>
              {s.debt_free_before != null && s.debt_free_after != null && s.debt_free_after !== s.debt_free_before && (
                <li>
                  Debt-free {dateLabel(s.debt_free_after)} instead of {dateLabel(s.debt_free_before)}.
                </li>
              )}
              {s.break_even_fee_pct && (
                <li style={{ color: L_T.muted }}>Still saves unless the processing fee is above {pct(s.break_even_fee_pct)} of the loan.</li>
              )}
              {s.payments_share_after && Number(s.payments_share_after) > 0.5 && (
                <li style={{ color: L_T.negative }}>
                  With it, loan payments take {pct(s.payments_share_after, 0)} of your take-home; lenders rarely approve past about half.
                </li>
              )}
            </ul>
          </div>
        ))}
        {data.scenarios.length === 0 && (
          <p style={{ margin: 0, fontSize: 12 }}>Enter a rate you’ve been quoted to see the numbers.</p>
        )}
      </div>
      {data.published && data.scenarios.some((s) => s.rate_basis !== 'yours') && (
        <p style={{ margin: 0, fontSize: 11, color: L_T.muted, lineHeight: 1.5 }}>
          Rates banks actually charged on personal loans, {data.published.period}, from {data.published.banks} banks’ own
          pages (as RBI requires them to publish). Your rate depends on your credit score and income; a bank’s “from” rate
          isn’t used as yours.
        </p>
      )}
      {runArgs && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <label style={{ fontSize: 11, display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
            Got a quote? Rate a year (%)
            <input
              inputMode="decimal"
              aria-label="Quoted rate, % a year"
              value={rate}
              onChange={(e) => setRate(e.target.value.replace(/[^\d.]/g, ''))}
              placeholder="e.g. 15.5"
              style={{ width: 90, padding: '4px 6px', border: `1px solid ${L_T.ink}`, fontFamily: 'inherit', fontSize: 13 }}
            />
            Fee (%)
            <input
              inputMode="decimal"
              aria-label="Processing fee, % of the loan"
              value={fee}
              onChange={(e) => setFee(e.target.value.replace(/[^\d.]/g, ''))}
              placeholder={india ? 'KFS' : 'offer'}
              style={{ width: 90, padding: '4px 6px', border: `1px solid ${L_T.ink}`, fontFamily: 'inherit', fontSize: 13 }}
            />
          </label>
          <LChipRow label="Over how long?">
            {[12, 24, 36, 48, 60].map((n) => (
              <LChip small key={n} on={tenure === n} onClick={() => { setTenure(n); void requote(n); }}>
                {n} months
              </LChip>
            ))}
          </LChipRow>
          <div>
            <LButton onClick={() => void requote()} disabled={busy}>{busy ? 'WORKING…' : 'CHECK MY QUOTE'}</LButton>
          </div>
          {err && <p role="alert" style={{ margin: 0, fontSize: 11, color: L_T.negative }}>{err}</p>}
        </div>
      )}
      {india && <details>
        <summary style={{ cursor: 'pointer', fontSize: 11, minHeight: 24 }}>How moving a card to a loan works in India</summary>
        <ul data-testid="cheaper-explainer" style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 11, lineHeight: 1.6 }}>
          {CONSOLIDATION_EXPLAINER.map((e) => (
            <li key={e.text.slice(0, 24)}>
              {e.text}
              {e.source && (
                <>
                  {' '}
                  <a href={e.source.url} target="_blank" rel="noopener noreferrer" style={{ color: L_T.accentInk }}>
                    {e.source.label}
                  </a>
                </>
              )}
            </li>
          ))}
        </ul>
      </details>}
      <p data-testid="cheaper-neutral" style={{ margin: 0, fontSize: 11, fontWeight: 600 }}>{data.neutrality}</p>
      <LBracket href="#offer-check">GOT AN OFFER ALREADY? CHECK IT ↓</LBracket>
    </section>
  );
}
