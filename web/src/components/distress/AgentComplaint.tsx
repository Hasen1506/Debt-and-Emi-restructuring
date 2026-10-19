'use client';

/**
 * A complaint about a recovery agent, to the lender's grievance officer
 * (A17: Vijay asked whether one universal letter is enough. It isn't: a
 * hardship request and a harassment complaint go to different desks and say
 * different things, so each gets its own draft, personalised from what the
 * user types). India only: it cites RBI's recovery-agent rules.
 */
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { LSectionHeader, LField, L_T, LBracket } from '@/components/ledger/primitives';
import { agentComplaintLetter, DRAFT_MARK, forSending } from '@/lib/distress-triage';
import { DraftLegalMarker } from '@/components/legal/DraftLegalMarker';
import { formatMonthDate, getCountryToday } from '@/lib/today';
import { readCantPayDraft, saveIndia, type AgentDraft } from '@/lib/cant-pay-draft';
import { HYDRATED_EVENT } from '@/lib/server-sync';

const captionStyle: CSSProperties = { fontSize: 'var(--fs-label)', fontFamily: 'var(--font-mono)', letterSpacing: '0.12em', color: L_T.muted, display: 'block', marginBottom: 4 };

export function AgentComplaintSection({
  name = '',
  lines = [],
  step,
}: {
  name?: string;
  lines?: Array<{ key: string; label: string; bank: string }>;
  step?: number;
}) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState('');
  const [lenderText, setLenderText] = useState<string | null>(null);
  const [nameText, setNameText] = useState(name);
  const [accountRef, setAccountRef] = useState('');
  const [when, setWhen] = useState('');
  const [what, setWhat] = useState('');
  const [agent, setAgent] = useState('');
  const [said, setSaid] = useState('');
  const loaded = useRef(false);
  const dirty = useRef(false);
  const keep = (patch: AgentDraft, sync: 'soon' | 'now' = 'soon') => {
    if (!loaded.current) return;
    dirty.current = true;
    saveIndia({ agent: patch }, sync);
  };
  useEffect(() => {
    const apply = (saved?: AgentDraft) => {
      if (!saved) return;
      if (saved.open) setOpen(true);
      if (saved.loanKey) setKey(saved.loanKey);
      if (saved.lender != null) setLenderText(saved.lender);
      if (saved.name != null) setNameText(saved.name);
      if (saved.account != null) setAccountRef(saved.account);
      if (saved.when != null) setWhen(saved.when);
      if (saved.what != null) setWhat(saved.what);
      if (saved.agent != null) setAgent(saved.agent);
    };
    apply(readCantPayDraft().in?.agent);
    loaded.current = true;
    const onHydrated = () => { if (!dirty.current) apply(readCantPayDraft().in?.agent); };
    window.addEventListener(HYDRATED_EVENT, onHydrated);
    return () => window.removeEventListener(HYDRATED_EVENT, onHydrated);
  }, []);
  const pick = lines.find((l) => l.key === key) ?? lines[0];
  const lender = lenderText ?? pick?.bank ?? '';
  const today = formatMonthDate(getCountryToday('IN'), 'long', true);
  const letter = agentComplaintLetter({
    name: nameText.trim(),
    lender: lender.trim(),
    loanLabel: pick?.label ?? 'loan',
    accountRef: accountRef.trim(),
    when: when.trim(),
    what: what.trim(),
    agent: agent.trim(),
    dateText: today,
  });
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(forSending(letter));
      setSaid('Complaint copied. Send it to the grievance officer named on the lender\u2019s website, and keep a copy.');
    } catch {
      setSaid('Couldn\u2019t copy here. Select the text and copy it by hand.');
    }
  };
  return (
    <section aria-labelledby="cp-agent" data-testid="cp-agent">
      <LSectionHeader step={step}>
        <span id="cp-agent">BEING HARASSED BY A RECOVERY AGENT? (COMPLAINT)</span>
      </LSectionHeader>
      <DraftLegalMarker id="letter-recovery-agent" />
      <p style={{ ...captionStyle, letterSpacing: 0, fontFamily: 'inherit' }} data-testid="letter-caution">{DRAFT_MARK}</p>
      {!open ? (
        <p style={{ fontSize: 'var(--fs-dense)', lineHeight: 1.7 }}>
          A different letter from the one above: it goes to the lender&apos;s grievance officer, says what happened and
          when, and cites RBI&apos;s rules.{' '}
          <button type="button" onClick={() => { setOpen(true); keep({ open: true }, 'now'); }} data-testid="cp-agent-open"
            style={{ background: 'none', border: 'none', padding: 0, font: 'inherit', fontWeight: 700, cursor: 'pointer', color: 'inherit', textDecoration: 'underline' }}>
            <span aria-hidden="true">[ </span>WRITE THE COMPLAINT<span aria-hidden="true"> ]</span>
          </button>
        </p>
      ) : (
        <>
          {lines.length > 1 && (
            <label style={{ display: 'block', marginBottom: 10 }}>
              <span style={captionStyle}>Loan</span>
              <select value={pick?.key} onChange={(e) => { setKey(e.target.value); setLenderText(null); keep({ loanKey: e.target.value, lender: '' }, 'now'); }}>
                {lines.map((l) => <option key={l.key} value={l.key}>{l.label}</option>)}
              </select>
            </label>
          )}
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <LField label="Lender" value={lender} onChange={(v) => { setLenderText(v); keep({ lender: v }); }} onBlur={() => keep({ lender: readCantPayDraft().in?.agent?.lender ?? lender }, 'now')} placeholder="e.g. HDFC Bank" />
            <LField label="Your name" value={nameText} onChange={(v) => { setNameText(v); keep({ name: v }); }} onBlur={() => keep({ name: readCantPayDraft().in?.agent?.name ?? nameText }, 'now')} placeholder="as on the loan" />
            <LField label="Loan account number" value={accountRef} onChange={(v) => { setAccountRef(v); keep({ account: v }); }} onBlur={() => keep({ account: readCantPayDraft().in?.agent?.account ?? accountRef }, 'now')} />
            <LField label="When (date and time)" value={when} onChange={(v) => { setWhen(v); keep({ when: v }); }} onBlur={() => keep({ when: readCantPayDraft().in?.agent?.when ?? when }, 'now')} placeholder="e.g. 12 Oct, 9:40 p.m." testId="cp-agent-when" />
            <LField label="What they did (short, factual)" value={what} onChange={(v) => { setWhat(v); keep({ what: v }); }} onBlur={() => keep({ what: readCantPayDraft().in?.agent?.what ?? what }, 'now')} placeholder="e.g. called my brother about my loan" testId="cp-agent-what" />
            <LField label="Agent or agency name, if known" value={agent} onChange={(v) => { setAgent(v); keep({ agent: v }); }} onBlur={() => keep({ agent: readCantPayDraft().in?.agent?.agent ?? agent }, 'now')} />
          </div>
          <label htmlFor="cp-agent-text" style={captionStyle}>The complaint (draft)</label>
          <textarea id="cp-agent-text" data-testid="cp-agent-text" readOnly value={letter} rows={14}
            style={{ width: '100%', fontFamily: 'inherit', fontSize: 'var(--fs-body)', lineHeight: 1.6, padding: 10, border: `1px solid ${L_T.ink}`, background: 'transparent', color: L_T.ink }} />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginTop: 10 }}>
            <button type="button" onClick={copy} style={{ background: 'none', border: 'none', padding: 0, font: 'inherit', fontWeight: 700, cursor: 'pointer', color: L_T.ink }}><span aria-hidden="true">[ </span>COPY<span aria-hidden="true"> ]</span></button>
            <LBracket href={`mailto:?subject=${encodeURIComponent('Complaint about recovery agent conduct')}&body=${encodeURIComponent(forSending(letter))}`}>EMAIL IT</LBracket>
          </div>
          <p role="status" aria-live="polite" style={{ fontSize: 'var(--fs-small)', color: L_T.positive, minHeight: 16, margin: '6px 0 0' }}>{said}</p>
          <p style={{ fontSize: 'var(--fs-small)', color: L_T.muted, lineHeight: 1.7 }}>
            Write down every call (date, time, number) and keep screenshots. If someone threatens violence, that is a police
            matter as well.
          </p>
        </>
      )}
    </section>
  );
}
