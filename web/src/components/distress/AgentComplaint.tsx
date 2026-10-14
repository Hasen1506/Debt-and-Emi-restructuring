'use client';

/**
 * A complaint about a recovery agent, to the lender's grievance officer
 * (A17: Vijay asked whether one universal letter is enough. It isn't: a
 * hardship request and a harassment complaint go to different desks and say
 * different things, so each gets its own draft, personalised from what the
 * user types). India only: it cites RBI's recovery-agent rules.
 */
import { useState, type CSSProperties } from 'react';
import { LSectionHeader, LField, L_T, LBracket } from '@/components/ledger/primitives';
import { agentComplaintLetter } from '@/lib/distress-triage';

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
  const pick = lines.find((l) => l.key === key) ?? lines[0];
  const lender = lenderText ?? pick?.bank ?? '';
  const today = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
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
      await navigator.clipboard.writeText(letter);
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
      {!open ? (
        <p style={{ fontSize: 'var(--fs-dense)', lineHeight: 1.7 }}>
          A different letter from the one above: it goes to the lender&apos;s grievance officer, says what happened and
          when, and cites RBI&apos;s rules.{' '}
          <button type="button" onClick={() => setOpen(true)} data-testid="cp-agent-open"
            style={{ background: 'none', border: 'none', padding: 0, font: 'inherit', fontWeight: 700, cursor: 'pointer', color: 'inherit', textDecoration: 'underline' }}>
            <span aria-hidden="true">[ </span>WRITE THE COMPLAINT<span aria-hidden="true"> ]</span>
          </button>
        </p>
      ) : (
        <>
          {lines.length > 1 && (
            <label style={{ display: 'block', marginBottom: 10 }}>
              <span style={captionStyle}>Loan</span>
              <select value={pick?.key} onChange={(e) => { setKey(e.target.value); setLenderText(null); }}>
                {lines.map((l) => <option key={l.key} value={l.key}>{l.label}</option>)}
              </select>
            </label>
          )}
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <LField label="Lender" value={lender} onChange={setLenderText} placeholder="e.g. HDFC Bank" />
            <LField label="Your name" value={nameText} onChange={setNameText} placeholder="as on the loan" />
            <LField label="Loan account number" value={accountRef} onChange={setAccountRef} />
            <LField label="When (date and time)" value={when} onChange={setWhen} placeholder="e.g. 12 Oct, 9:40 p.m." testId="cp-agent-when" />
            <LField label="What they did (short, factual)" value={what} onChange={setWhat} placeholder="e.g. called my brother about my loan" testId="cp-agent-what" />
            <LField label="Agent or agency name, if known" value={agent} onChange={setAgent} />
          </div>
          <label htmlFor="cp-agent-text" style={captionStyle}>The complaint (draft)</label>
          <textarea id="cp-agent-text" data-testid="cp-agent-text" readOnly value={letter} rows={14}
            style={{ width: '100%', fontFamily: 'inherit', fontSize: 'var(--fs-body)', lineHeight: 1.6, padding: 10, border: `1px solid ${L_T.ink}`, background: 'transparent', color: L_T.ink }} />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginTop: 10 }}>
            <button type="button" onClick={copy} style={{ background: 'none', border: 'none', padding: 0, font: 'inherit', fontWeight: 700, cursor: 'pointer', color: L_T.ink }}><span aria-hidden="true">[ </span>COPY<span aria-hidden="true"> ]</span></button>
            <LBracket href={`mailto:?subject=${encodeURIComponent('Complaint about recovery agent conduct')}&body=${encodeURIComponent(letter)}`}>EMAIL IT</LBracket>
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
