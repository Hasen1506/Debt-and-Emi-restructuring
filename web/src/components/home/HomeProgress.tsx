'use client';

/**
 * Under "Pay this month": the months-shaved counter, a share card with no
 * amounts, and this month's prompts (G7). Everything here reads what the
 * page already worked out and what this device remembers; nothing is sent.
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
}) {
  const [marks, setMarks] = useState<DebtFreeMark[]>([]);
  const [moved, setMoved] = useState(false);
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [said, setSaid] = useState('');
  const [showCard, setShowCard] = useState(false);
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
    }));
  }, [ym, todayIso, today, country, pay]);

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

  async function copyPlan() {
    const text = planContext({
      country, monthLabel, debtFreeLabel: shareInput.debtFreeLabel, pay, loans, strategy, fmt,
    });
    try {
      await navigator.clipboard.writeText(text);
      setSaid('Copied. Paste it into the assistant you use. It has no names or account numbers.');
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
      <p style={{ margin: '0 0 8px', fontSize: 13, lineHeight: 1.6 }}>
        {s ? shavedLine(s) : ym ? `Debt-free in ${ymLabel(ym)}. Each extra payment you log moves it sooner, and this counter keeps score.` : 'Once the plan has a debt-free date, this counts the months you take off it.'}
      </p>
      {ym && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
          <button type="button" style={lPayBtn(false)} onClick={() => setShowCard((v) => !v)}>{showCard ? 'HIDE THE CARD' : 'SHARE MY PROGRESS'}</button>
          {showCard && <button type="button" style={lPayBtn(true)} onClick={() => void share()}>SHARE</button>}
        </div>
      )}
      {showCard && ym && (
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
                {p.action === 'copy_plan' && <button type="button" style={lPayBtn(false)} onClick={() => void copyPlan()}>COPY MY PLAN</button>}
                <button type="button" onClick={() => later(p)} style={{ background: 'none', border: 0, color: L_T.muted, textDecoration: 'underline', cursor: 'pointer', fontSize: 11 }}>
                  Next month
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {said && <p role="status" style={{ fontSize: 12, color: L_T.positive }}>{said}</p>}
    </section>
  );
}
