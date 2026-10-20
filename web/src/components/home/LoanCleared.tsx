'use client';

/**
 * A loan just cleared (grill "fun"): a small celebration, the freed-up EMI
 * shown rolling into the next loan, and the last letter to send: a closure
 * request (no-dues letter, documents back, charge removed), drafted by the
 * engine with the RBI rule and its dates (engine/closure_letter.py).
 */
import { useState } from 'react';
import { browserApiBase } from '@/lib/api-base';
import { formatCurrencyWhole } from '@/lib/api';
import { buildIcs } from '@/lib/ics';
import { L_T, lPayBtn, lStrip } from '@/components/ledger/primitives';

interface Letter {
  subject: string;
  body: string;
  key_dates: { key: string; label: string; day: string; note: string }[];
  checklist: string[];
  citations: { rule: string; source: string; as_of: string }[];
  notes: string[];
}

const KINDS: { value: string; label: string }[] = [
  { value: 'bank', label: 'A bank' },
  { value: 'nbfc', label: 'An NBFC (finance company)' },
  { value: 'hfc', label: 'A housing finance company' },
  { value: 'unknown', label: 'Not sure' },
];

export function LoanCleared({
  name,
  loanType,
  lender,
  country,
  currency,
  freed,
  nextName,
  todayIso,
  onClose,
}: {
  name: string;
  loanType: string;
  lender: string;
  country: 'IN' | 'US';
  currency: string;
  /** The EMI or minimum that no longer goes to this loan. */
  freed: number;
  /** Where the plan sends the extra next, if anywhere. */
  nextName?: string;
  todayIso: string;
  onClose: () => void;
}) {
  const [kind, setKind] = useState('unknown');
  const [letter, setLetter] = useState<Letter | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  async function draft() {
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch(`${browserApiBase()}/api/closure-letter`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ market: country, loan_type: loanType, lender, closed_on: todayIso, today: todayIso, lender_kind: kind }),
      });
      if (!r.ok) throw new Error();
      setLetter(await r.json());
    } catch {
      setErr('The letter couldn’t be drafted right now. Try again in a minute.');
    } finally {
      setBusy(false);
    }
  }

  function calendar() {
    if (!letter) return;
    const ics = buildIcs(letter.key_dates.map((d) => ({ uid: `closure-${loanType}-${d.key}-${d.day}`, day: d.day, title: `${name}: ${d.label}`, description: d.note })));
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }));
    a.download = 'rightdue-closure-dates.ics';
    document.body.appendChild(a);
    a.click();
    a.remove();
    const toRevoke = a.href;
    window.setTimeout(() => URL.revokeObjectURL(toRevoke), 1500);
  }

  const fmt = (v: number) => formatCurrencyWhole(Math.round(v), currency);
  return (
    <section aria-labelledby="loan-cleared" role="dialog" style={{ marginTop: 14, padding: '16px 18px', border: `2px solid ${L_T.ink}`, background: L_T.paper }}>
      <style>{`@keyframes rdCut{0%{transform:translateX(0)}100%{transform:translateX(calc(100% - 28px))}}
@media (prefers-reduced-motion: reduce){.rd-cut{animation:none!important}}`}</style>
      <div aria-hidden="true" style={{ position: 'relative', height: 28, borderTop: `2px dashed ${L_T.ink}`, marginBottom: 10 }}>
        <span className="rd-cut" style={{ position: 'absolute', top: -16, left: 0, fontSize: 22, animation: 'rdCut 1.2s ease-out forwards' }}>✂</span>
      </div>
      <h3 id="loan-cleared" style={{ margin: '0 0 6px', fontSize: 18 }}>{name}: cleared.</h3>
      <p style={{ margin: '0 0 10px', fontSize: 13, lineHeight: 1.6 }}>
        {freed > 0
          ? nextName
            ? `The ${fmt(freed)} a month that went here now goes to ${nextName}, on top of its own payment. The plan already counts it.`
            : `That's ${fmt(freed)} a month back for you.`
          : 'Nothing more goes to this loan.'}
      </p>
      {!letter ? (
        <>
          <p style={{ margin: '0 0 8px', fontSize: 12, color: L_T.inkSoft, lineHeight: 1.6 }}>
            One last letter: ask {lender || 'the lender'} for a closure (no-dues) letter
            {loanType === 'credit_card' ? ' and to close the card' : ', your documents back'} and to tell the credit bureaus.
          </p>
          {country === 'IN' && (
            <label style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
              Your lender is{' '}
              <select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Lender type">
                {KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
              </select>
            </label>
          )}
          <button type="button" style={lPayBtn(true)} onClick={draft} disabled={busy}>{busy ? 'DRAFTING…' : 'DRAFT THE CLOSURE LETTER'}</button>{' '}
          <button type="button" style={lPayBtn(false)} onClick={onClose}>LATER</button>
          {err && <p role="alert" style={{ color: L_T.negative, fontSize: 12 }}>{err}</p>}
        </>
      ) : (
        <>
          <p style={{ margin: '0 0 8px', padding: '6px 10px', fontSize: 12, ...lStrip('accent') }}>
            DRAFT. Read it and fill in the brackets before you send it. This is not legal advice.
          </p>
          <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12, lineHeight: 1.55, padding: 12, border: `1px solid ${L_T.ruleSoft}`, maxHeight: 360, overflow: 'auto' }}>{letter.body}</pre>
          {letter.key_dates.length > 0 && (
            <ul style={{ fontSize: 12, lineHeight: 1.6, paddingLeft: 18 }}>
              {letter.key_dates.map((d) => <li key={d.key}><strong>{d.label} {d.day}</strong>. {d.note}</li>)}
            </ul>
          )}
          {letter.notes.map((n) => <p key={n} style={{ fontSize: 12, color: L_T.muted }}>{n}</p>)}
          <details style={{ fontSize: 12, margin: '6px 0' }}>
            <summary>Check before sending</summary>
            <ul style={{ paddingLeft: 18, lineHeight: 1.6 }}>{letter.checklist.map((c) => <li key={c}>{c}</li>)}</ul>
            {letter.citations.map((c) => (
              <p key={c.rule} style={{ color: L_T.muted }}>Rule: {c.rule}. Source: <a href={c.source} target="_blank" rel="noreferrer">rbi.org.in</a>, read {c.as_of}.</p>
            ))}
          </details>
          <button type="button" style={lPayBtn(true)} onClick={() => { void navigator.clipboard?.writeText(letter.body).then(() => setCopied(true)); }}>
            {copied ? 'COPIED' : 'COPY THE LETTER'}
          </button>{' '}
          {letter.key_dates.length > 0 && <button type="button" style={lPayBtn(false)} onClick={calendar}>ADD THE DATES TO MY CALENDAR</button>}{' '}
          <button type="button" style={lPayBtn(false)} onClick={onClose}>DONE</button>
        </>
      )}
    </section>
  );
}
