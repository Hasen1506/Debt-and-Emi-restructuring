'use client';

/**
 * US letters (round 2, 15 Oct 2026; audit 80+ D11). The landing page says
 * "Federal, state and card rules for the USA"; this is the page that backs
 * it: three letters a US borrower can send today.
 *
 *   Hardship request          built in the browser (lib/distress-triage
 *                             hardshipLetter, US words), with the collector
 *                             rules (12 CFR 1006.6).
 *   Card billing dispute      /api/complaints/us kind=fcba_billing_error
 *   Mortgage notice of error  /api/complaints/us kind=respa_notice_of_error
 *
 * Public like the rest of /cant-pay (no sign-in, robots-disallowed). The API
 * returns placeholders only; the name, account and address are filled in
 * here and never leave the device. Every letter carries the "Draft — pending
 * legal review" marker until counsel signs off (docs/FOUNDER-RECORDS.md).
 */
import { useEffect, useState, type CSSProperties } from 'react';
import { clearCantPay, readCantPayDraft, saveUs } from '@/lib/cant-pay-draft';
import { LShell, LSectionHeader, LBracket, LField, L_T } from '@/components/ledger/primitives';
import { DraftLegalMarker } from '@/components/legal/DraftLegalMarker';
import { formatCurrencyWhole, type LoanType } from '@/lib/api';
import { complaintUs, type UsComplaintKind, type UsComplaintResponse } from '@/lib/us-complaints-api';
import { forSending, US_COLLECTOR_RULE } from '@/lib/distress-triage';
import { US_FIELDS, US_LETTER_TITLES, fillUsLetter, usMissing, type UsLetterValues } from '@/lib/us-letters';
import { LetterSection, Rule, type Line } from './CantPay';
import { UsCollectionLetter } from './UsCollectionLetter';
import { US_COLLECTION_KINDS, US_COLLECTION_SUB, US_COLLECTION_TITLES, type UsCollectionKind } from '@/lib/us-collection-letters';
import { PUBLIC_LETTER_KINDS } from './CantPayPublic';

type Kind = 'hardship' | UsComplaintKind | UsCollectionKind;
const KINDS: Kind[] = ['hardship', 'fcba_billing_error', 'respa_notice_of_error', ...US_COLLECTION_KINDS];
const KIND_SUB: Record<Kind, string> = {
  ...US_COLLECTION_SUB,
  hardship: 'Can’t pay in full: ask the lender for its hardship program before the due date.',
  fcba_billing_error: 'A wrong or unauthorised charge on a credit card statement (60-day deadline).',
  respa_notice_of_error: 'Your mortgage servicer made a mistake: a payment not credited, a wrong fee or escrow charge.',
};

const caption: CSSProperties = { fontSize: 'var(--fs-label)', fontFamily: 'var(--font-mono)', letterSpacing: '0.12em', color: L_T.muted, display: 'block', marginBottom: 4 };
const body: CSSProperties = { fontSize: 'var(--fs-body)', lineHeight: 1.6 };

function kindFromUrl(): Kind {
  if (typeof window === 'undefined') return 'hardship';
  const k = new URLSearchParams(window.location.search).get('kind');
  return KINDS.includes(k as Kind) ? (k as Kind) : 'hardship';
}

const tab = (on: boolean): CSSProperties => ({
  background: on ? L_T.ink : 'transparent',
  color: on ? 'var(--canvas, #fff)' : L_T.ink,
  border: `1px solid ${L_T.ink}`,
  padding: '8px 12px',
  font: 'inherit',
  fontSize: 'var(--fs-dense)',
  fontWeight: 700,
  cursor: 'pointer',
  minHeight: 44,
  textAlign: 'left',
});

export function UsLetters() {
  const [kind, setKind] = useState<Kind>('hardship');
  useEffect(() => setKind(kindFromUrl()), []);
  const choose = (k: Kind) => {
    setKind(k);
    if (typeof window !== 'undefined') {
      const url = k === 'hardship' ? window.location.pathname : `${window.location.pathname}?kind=${k}`;
      window.history.replaceState(null, '', url);
    }
  };
  return (
    <LShell>
      <div style={{ padding: '24px 0 48px', display: 'flex', flexDirection: 'column', gap: 24, width: '100%' }} data-testid="us-letters">
        <section aria-labelledby="usl-head">
          <h1 id="usl-head" style={{ fontSize: 20, margin: 0, letterSpacing: '0.02em' }}>US LETTERS: HARDSHIP, DISPUTES, DEBT COLLECTORS</h1>
          <p style={{ ...body, marginTop: 8 }}>
            Federal rules for the USA, as letters you can send yourself. The hardship letter stays on this device, and
            in your account when you are signed in. Each one is a draft: read it against your statement before you send it.
          </p>
          <div role="radiogroup" aria-label="Which letter" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
            {KINDS.map((k) => (
              <button key={k} type="button" role="radio" aria-checked={kind === k} style={tab(kind === k)}
                onClick={() => choose(k)} data-testid={`usl-kind-${k}`}>
                {k in US_LETTER_TITLES ? US_LETTER_TITLES[k as keyof typeof US_LETTER_TITLES] : US_COLLECTION_TITLES[k as UsCollectionKind]}
              </button>
            ))}
          </div>
          <p style={{ ...body, color: L_T.muted, marginTop: 8 }} data-testid="usl-kind-sub">{KIND_SUB[kind]}</p>
        </section>
        {kind === 'hardship' ? <Hardship />
          : US_COLLECTION_KINDS.includes(kind as UsCollectionKind) ? <UsCollectionLetter key={kind} kind={kind as UsCollectionKind} />
          : <ApiLetter key={kind} kind={kind as UsComplaintKind} />}
        <p style={{ fontSize: 'var(--fs-small)', color: L_T.muted }}>
          Rules from the CFPB&apos;s Regulation Z (12 CFR 1026.13), Regulation X (12 CFR 1024.35) and Regulation F
          (12 CFR 1006.6, 1006.34, 1006.38) and the FDCPA. A draft, not legal advice. In India instead?{' '}
          <LBracket href="/cant-pay">CAN&apos;T PAY (INDIA)</LBracket>
        </p>
      </div>
    </LShell>
  );
}

function Hardship() {
  const kinds = PUBLIC_LETTER_KINDS.US;
  const [type, setType] = useState<LoanType>('credit_card');
  const [epoch, setEpoch] = useState(0);
  useEffect(() => {
    const saved = readCantPayDraft().us?.loanType as LoanType | undefined;
    if (saved && kinds.some((k) => k.type === saved)) setType(saved);
  }, [epoch, kinds]);
  const chooseType = (next: LoanType) => {
    setType(next);
    saveUs({ loanType: next }, 'now');
  };
  const startOver = () => {
    clearCantPay('us');
    setType('credit_card');
    setEpoch((n) => n + 1);
  };
  const k = kinds.find((x) => x.type === type) ?? kinds[0];
  const line: Line = {
    key: k.type, label: k.label, loan_type: k.type, required: 0, ratePct: 0, floating: false, bank: '',
    tier: 'unsecured', reason: '', covered: 'none', pay: 0, short: 0,
  };
  const fc = (v: number) => formatCurrencyWhole(Math.round(v), 'USD');
  return (
    <>
      <div data-testid="usl-hardship">
        <p style={{ fontSize: 'var(--fs-body)', margin: '0 0 8px' }}>
          <LBracket onClick={startOver}>START OVER</LBracket>
          <span style={{ color: L_T.muted }}> Clears this letter. </span>
        </p>
        <LetterSection
          key={epoch}
          lines={[line]}
          name=""
          fc={fc}
          country="US"
          step={1}
          loanPicker={
            <label style={{ display: 'block', marginBottom: 10 }}>
              <span style={caption}>Kind of loan</span>
              <select value={k.type} onChange={(e) => chooseType(e.target.value as LoanType)} data-testid="usl-hardship-kind">
                {kinds.map((x) => <option key={x.type} value={x.type}>{x.label}</option>)}
              </select>
            </label>
          }
        />
      </div>
      <section aria-labelledby="usl-rights" data-testid="usl-rights">
        <LSectionHeader step={2}><span id="usl-rights">YOUR RIGHTS WITH DEBT COLLECTORS</span></LSectionHeader>
        <Rule r={US_COLLECTOR_RULE} />
      </section>
    </>
  );
}

function ApiLetter({ kind }: { kind: UsComplaintKind }) {
  const [res, setRes] = useState<UsComplaintResponse | null>(null);
  const [err, setErr] = useState('');
  const [values, setValues] = useState<UsLetterValues>({});
  const [statementOn, setStatementOn] = useState('');
  const [sentOn, setSentOn] = useState('');
  const [said, setSaid] = useState('');
  const [tries, setTries] = useState(0);

  useEffect(() => {
    let live = true;
    setErr('');
    // FCBA deadlines need the statement date as well as the sent date.
    const track = sentOn && (kind !== 'fcba_billing_error' || statementOn);
    const req = {
      kind,
      ...(track ? { sent_on: sentOn } : {}),
      ...(track && kind === 'fcba_billing_error' ? { statement_on: statementOn } : {}),
    };
    complaintUs(req)
      .then((r) => { if (live) setRes(r); })
      .catch((e: unknown) => { if (live) setErr(e instanceof Error ? e.message : 'Could not load the letter.'); });
    return () => { live = false; };
  }, [kind, sentOn, statementOn, tries]);

  const letter = res ? fillUsLetter(res.letter.text, values) : '';
  const missing = usMissing(kind, values);
  const subject = res ? fillUsLetter(res.letter.subject, values) : '';
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(forSending(letter));
      setSaid('Letter copied. Print it, sign it and send it by certified mail (or as the statement says).');
    } catch {
      setSaid('Couldn’t copy here. Select the letter and copy it by hand.');
    }
  };
  const download = () => {
    const blob = new Blob([forSending(letter)], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = kind === 'fcba_billing_error' ? 'billing-error-notice.txt' : 'notice-of-error.txt';
    a.click();
    URL.revokeObjectURL(a.href);
    setSaid(`Saved as ${a.download}.`);
  };

  return (
    <>
      <section aria-labelledby="usl-letter" data-testid={`usl-${kind}`}>
        <LSectionHeader step={1}><span id="usl-letter">{US_LETTER_TITLES[kind].toUpperCase()}</span></LSectionHeader>
        <DraftLegalMarker id="letter-us" />
        {err && (
          <p role="alert" style={{ ...body, color: L_T.negative }} data-testid="usl-error">
            {err} <LBracket onClick={() => setTries((t) => t + 1)}>TRY AGAIN</LBracket>
          </p>
        )}
        {!res && !err && <p role="status" style={body}>Loading the letter…</p>}
        {res && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
              {US_FIELDS[kind].map((f) => (
                <LField key={f.key} label={f.label} value={values[f.key] ?? ''} placeholder={f.placeholder}
                  onChange={(v) => setValues((cur) => ({ ...cur, [f.key]: v }))} testId={`usl-f-${f.key}`} />
              ))}
            </div>
            {missing.length > 0 && (
              <p style={{ ...body, color: L_T.muted }} data-testid="usl-missing">Still needed: {missing.join(', ')}.</p>
            )}
            <label htmlFor="usl-text" style={{ ...caption, marginTop: 12 }}>The letter (read it before you send it)</label>
            <textarea id="usl-text" readOnly value={letter} rows={16} data-testid="usl-text"
              style={{ width: '100%', fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-dense)', lineHeight: 1.5, padding: 10, border: `1px solid ${L_T.ruleSoft}` }} />
            <p style={{ ...body, color: L_T.accent, margin: '6px 0' }} role="note" data-testid="usl-draft-notice">{res.letter.draft_notice}</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginTop: 6 }}>
              <LBracket onClick={copy} accent>COPY THE LETTER</LBracket>
              <LBracket onClick={download}>DOWNLOAD (.TXT)</LBracket>
              <LBracket href={`mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(forSending(letter))}`}>OPEN IN EMAIL</LBracket>
            </div>
            <p role="status" aria-live="polite" style={{ fontSize: 'var(--fs-small)', color: L_T.positive, minHeight: 16, margin: '6px 0 0' }} data-testid="usl-said">{said}</p>
          </>
        )}
      </section>

      {res && (
        <section aria-labelledby="usl-send" data-testid="usl-how-to-send">
          <LSectionHeader step={2}><span id="usl-send">WHERE AND HOW TO SEND IT</span></LSectionHeader>
          <ul style={{ ...body, paddingLeft: 18, margin: 0 }}>
            {res.letter.how_to_send.map((t) => <li key={t}>{t}</li>)}
          </ul>
        </section>
      )}

      {res && (
        <section aria-labelledby="usl-track" data-testid="usl-track">
          <LSectionHeader step={3}><span id="usl-track">AFTER YOU SEND IT: THE DEADLINES</span></LSectionHeader>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
            {kind === 'fcba_billing_error' && (
              <label style={{ display: 'block' }}>
                <span style={caption}>First statement showing the error</span>
                <input type="date" value={statementOn} onChange={(e) => setStatementOn(e.target.value)} data-testid="usl-statement-on" style={{ minHeight: 44 }} />
              </label>
            )}
            <label style={{ display: 'block' }}>
              <span style={caption}>Date you sent it</span>
              <input type="date" value={sentOn} onChange={(e) => setSentOn(e.target.value)} data-testid="usl-sent-on" style={{ minHeight: 44 }} />
            </label>
          </div>
          {res.timeline ? (
            <>
              <ol style={{ ...body, paddingLeft: 18, margin: '10px 0 0' }} data-testid="usl-timeline">
                {res.timeline.milestones.map((m) => (
                  <li key={m.key + m.day}><strong>{m.day}</strong>: {m.label}{m.note ? ` (${m.note})` : ''}</li>
                ))}
              </ol>
              <p style={body} data-testid="usl-next">{res.timeline.next_action}</p>
            </>
          ) : (
            <p style={{ ...body, color: L_T.muted }}>Add the date{kind === 'fcba_billing_error' ? 's' : ''} above to see when the answer is due.</p>
          )}
          <ul style={{ ...body, paddingLeft: 18, margin: '10px 0 0' }} data-testid="usl-if-no-answer">
            {res.letter.if_no_answer.map((t) => <li key={t}>{t}</li>)}
          </ul>
          <p style={{ fontSize: 'var(--fs-small)', color: L_T.muted }}>
            Sources:{' '}
            {res.letter.sources.map((u, i) => (
              <span key={u}>{i > 0 ? ' · ' : ''}<a href={u} rel="noopener noreferrer" target="_blank">{u.replace(/^https:\/\/(www\.)?/, '')}</a></span>
            ))}
          </p>
        </section>
      )}
    </>
  );
}
