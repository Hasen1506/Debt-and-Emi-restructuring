'use client';

/**
 * Under "Pay this month": the months-shaved counter, a share card with no
 * amounts, and this month's prompts (G7). Everything here reads what the
 * page already worked out and what this device remembers.
 *
 * Audit 80 (W5): the share card is offered only after a real move (the
 * debt-free date came in, or a loan cleared: A14); the payday email's link
 * opens a 60-second ritual here (?ritual=payday: A14/E8); "Hide until next
 * month" says what the link does (A12); the assistant prompt is a paste-in
 * checker with Copy my plan kept (A8); RightDue Plus is a fake door after
 * month 1 (A18); the rate-move email opt-in sits here (A13). Only the advice
 * check (stateless) and the counts-only funnel send anything.
 */
import { useEffect, useMemo, useState } from 'react';
import { formatCurrencyWhole } from '@/lib/api';
import { readActivityClient } from '@/lib/activity';
import { debtFreeYm, readMarks, recordMark, shaved, shavedLine, writeMarks, ymLabel, type DebtFreeMark } from '@/lib/months-shaved';
import { monthlyPrompts, snooze, PROMPTS_SNOOZE_KEY, type Prompt } from '@/lib/monthly-prompts';
import { planContext } from '@/lib/plan-context';
import { readPending, dueChecks } from '@/lib/upi-confirm';
import { shareCardSvg, shareText } from '@/lib/share-card';
import type { PayThisMonth } from '@/lib/pay-this-month';
import { L_T, LSectionHeader, lPayBtn } from '@/components/ledger/primitives';
import { notePlanVisit } from '@/lib/funnel';
import type { AdviceLoan } from '@/lib/advice-check';
import { AdviceCheck } from '@/components/retention/AdviceCheck';
import { FakeDoor } from '@/components/retention/FakeDoor';
import { RateMoveEmail, type RateWatchLoan } from '@/components/retention/RateMoveEmail';

/** A14: share only after real progress, never on day 1. */
export function hasRealProgress(monthsSooner: number, loansCleared: number): boolean {
  return monthsSooner > 0 || loansCleared > 0;
}

export interface ProgressLoan { type: string; outstanding: number; ratePct: number | null; emi: number | null; currency: string }

export function HomeProgress({
  country,
  todayIso,
  debtFreeMonth,
  loans,
  loansCleared,
  pay,
  strategy,
  monthLabel,
  shortLine,
  adviceLoans = [],
  extraTarget = null,
  rateLoans = [],
  firstBalanceYm = null,
}: {
  country: 'IN' | 'US';
  todayIso: string;
  /** The engine's month index (1 = this month), or null with no date. */
  debtFreeMonth: number | null;
  loans: ProgressLoan[];
  /** Loans on file that are paid off. */
  loansCleared: number;
  pay: PayThisMonth;
  strategy: string;
  monthLabel: string;
  /** UX50 B-13: short this month, the headline's own words. */
  shortLine?: string;
  /** A8: the open loans as the advice check reads them, and which one gets this month's extra. */
  adviceLoans?: AdviceLoan[];
  extraTarget?: number | null;
  /** A13: floating-rate loans the rate-move email can watch. */
  rateLoans?: RateWatchLoan[];
  /** UX walkthrough fix 13: the earliest balance date on file ("YYYY-MM"). */
  firstBalanceYm?: string | null;
}) {
  const [marks, setMarks] = useState<DebtFreeMark[]>([]);
  const [moved, setMoved] = useState(false);
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [said, setSaid] = useState('');
  const [showCard, setShowCard] = useState(false);
  const [showCheck, setShowCheck] = useState(false);
  const [ritual, setRitual] = useState(false);
  const [sinceFirst, setSinceFirst] = useState<number | null>(null);
  const today = useMemo(() => new Date(`${todayIso}T12:00:00`), [todayIso]);
  const ccy = country === 'IN' ? 'INR' : 'USD';
  const fmt = (v: number, c = ccy) => formatCurrencyWhole(Math.round(v), c);
  const ym = debtFreeMonth && debtFreeMonth > 0 ? debtFreeYm(debtFreeMonth, today) : null;

  useEffect(() => {
    const before = readMarks();
    const after = ym ? recordMark(before, ym, todayIso) : before;
    if (after !== before) writeMarks(after);
    setMarks(after);
    const changed = after.length > before.length && before.length > 0;
    setMoved(changed);
    // A15: first plan month on this device; a visit the month after counts once.
    if (ym) setSinceFirst(notePlanVisit(todayIso.slice(0, 7), country));
    try {
      const q = new URLSearchParams(window.location.search);
      setRitual(q.get('ritual') === 'payday');
      if (q.get('check') === 'advice') setShowCheck(true);
    } catch { /* no URL */ }
    let snoozed: string[] = [];
    try { snoozed = JSON.parse(window.localStorage.getItem(PROMPTS_SNOOZE_KEY) || '[]'); } catch { /* none */ }
    setPrompts(monthlyPrompts({
      today,
      country,
      loansWithPayments: pay.rows.filter((r) => r.loanIndex !== null).length,
      activityDates: readActivityClient().map((e) => e.date),
      pendingUpi: dueChecks(readPending(), new Date()),
      snoozed: Array.isArray(snoozed) ? snoozed : [],
      debtFreeMoved: changed,
      firstBalanceYm,
    }));
  }, [ym, todayIso, today, country, pay, firstBalanceYm]);

  const s = ym ? shaved(marks, todayIso.slice(0, 7)) : null;
  const shareInput = {
    debtFreeLabel: ym ? ymLabel(ym) : null,
    monthsShaved: s && s.vsFirst > 0 ? s.vsFirst : 0,
    loansCleared,
    loansTotal: loans.length + loansCleared,
  };

  function later(p: Prompt) {
    let list: string[] = [];
    try { list = JSON.parse(window.localStorage.getItem(PROMPTS_SNOOZE_KEY) || '[]'); } catch { /* none */ }
    const next = snooze(Array.isArray(list) ? list : [], p.key, today);
    try { window.localStorage.setItem(PROMPTS_SNOOZE_KEY, JSON.stringify(next)); } catch { /* this visit */ }
    setPrompts((ps) => ps.filter((x) => x.key !== p.key));
  }

  const realMove = hasRealProgress(shareInput.monthsShaved, loansCleared);

  async function copyPlan() {
    const text = planContext({
      country, monthLabel, debtFreeLabel: shareInput.debtFreeLabel, pay, loans, strategy, fmt,
      checkUrl: `${window.location.origin}/?check=advice#advice-check`,
    });
    try {
      await navigator.clipboard.writeText(text);
      setSaid('Copied. Paste it into the assistant you use (no names or account numbers), then paste its answer back here to check it.');
    } catch {
      setSaid('Copying isn’t allowed here. Select the text from Plan instead.');
    }
  }

  async function share() {
    const text = shareText(shareInput);
    const svg = shareCardSvg(shareInput);
    try {
      const file = new File([svg], 'rightdue-progress.svg', { type: 'image/svg+xml' });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ text, files: [file] });
        return;
      }
      if (navigator.share) {
        await navigator.share({ text });
        return;
      }
      await navigator.clipboard.writeText(text);
      setSaid('Copied the words. Download the card below to post it.');
    } catch { /* the user closed the share sheet */ }
  }

  return (
    <section aria-labelledby="home-progress" style={{ marginTop: 18 }}>
      <LSectionHeader><span id="home-progress">Your progress</span></LSectionHeader>
      {ritual && (
        <div role="note" aria-label="Payday check" data-testid="payday-ritual"
          style={{ margin: '0 0 10px', padding: '10px 12px', border: `1px solid ${L_T.ink}`, background: L_T.paper, fontSize: 'var(--fs-dense)', lineHeight: 1.6 }}>
          <strong>Your 60-second payday check</strong>
          <ol style={{ margin: '4px 0 0', paddingLeft: 18 }}>
            <li>Tap <strong>MARK PAID</strong> on each payment above that went out, or <a href="/profile?step=loans">paste the bank SMS</a> to update a balance.</li>
            <li>Log any extra you paid in <a href="/activity#activity-ledger">Activity</a>: the counter below moves when your debt-free date does.</li>
            <li>{realMove ? 'You’ve made real progress: share it below if you like.' : 'Sharing opens once the date actually moves. No progress card for nothing.'}</li>
          </ol>
        </div>
      )}
      <p style={{ margin: '0 0 8px', fontSize: 13, lineHeight: 1.6 }}>
        {s ? shavedLine(s) : ym ? `Debt-free in ${ymLabel(ym)}. Each extra payment you log moves it sooner, and this counter keeps score.` : shortLine ?? 'Once the plan has a debt-free date, this counts the months you take off it.'}
      </p>
      {ym && realMove && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
          <button type="button" style={lPayBtn(false)} onClick={() => setShowCard((v) => !v)}>{showCard ? 'HIDE THE CARD' : 'SHARE MY PROGRESS'}</button>
          {showCard && <button type="button" style={lPayBtn(true)} onClick={() => void share()}>SHARE</button>}
        </div>
      )}
      {showCard && ym && realMove && (
        <figure style={{ margin: '0 0 12px' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            alt={shareText(shareInput)}
            width={270}
            height={270}
            src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(shareCardSvg(shareInput))}`}
            style={{ border: `1px solid ${L_T.ruleSoft}` }}
          />
          <figcaption style={{ fontSize: 11, color: L_T.muted }}>
            No amounts, lenders or income on it. <a download="rightdue-progress.svg" href={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(shareCardSvg(shareInput))}`}>Download the card</a>
          </figcaption>
        </figure>
      )}
      {prompts.length > 0 && (
        <div aria-label="This month" style={{ borderTop: `1px dashed ${L_T.ruleSoft}`, paddingTop: 8 }}>
          <div style={{ fontSize: 10, letterSpacing: '0.16em', color: L_T.muted, fontWeight: 600, marginBottom: 4 }}>THIS MONTH</div>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {prompts.map((p) => (
              <li key={p.key} style={{ fontSize: 12, lineHeight: 1.6, padding: '6px 0', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <span style={{ flex: '1 1 260px' }}>{p.text}</span>
                {p.href && <a href={p.href} style={{ ...lPayBtn(false), textDecoration: 'none' }}>OPEN</a>}
                {p.action === 'check_advice' && (
                  <button type="button" style={lPayBtn(true)} aria-expanded={showCheck} onClick={() => setShowCheck((v) => !v)}>
                    {showCheck ? 'CLOSE' : 'CHECK ADVICE'}
                  </button>
                )}
                {(p.action === 'copy_plan' || p.action === 'check_advice') && <button type="button" style={lPayBtn(false)} onClick={() => void copyPlan()}>COPY MY PLAN</button>}
                {/* A12: it hides the prompt on this device; it never sent anything. */}
                {/* UI revert 2: a visible close (✕) in the ledger's outline
                    button, so the notice is plainly dismissible. */}
                <button type="button" className="l-hit" onClick={() => later(p)} aria-label="Hide until next month" title="Hide until next month" style={{ ...lPayBtn(false), fontSize: 11, padding: '6px 10px', color: L_T.muted, border: `1px solid ${L_T.muted}` }}>
                  <span aria-hidden="true">✕ HIDE UNTIL NEXT MONTH</span>
                </button>
                {p.action === 'check_advice' && showCheck && (
                  <div style={{ flexBasis: '100%' }}>
                    <AdviceCheck loans={adviceLoans} extraTarget={extraTarget} strategy={strategy} country={country} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {said && <p role="status" style={{ fontSize: 12, color: L_T.positive }}>{said}</p>}
      {country === 'IN' && <RateMoveEmail loans={rateLoans} />}
      {/* A18: after the first month on this device, a fake door for a paid tier (counts only). */}
      {sinceFirst !== null && sinceFirst >= 1 && <FakeDoor door="plus" />}
    </section>
  );
}
