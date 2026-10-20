'use client';

/**
 * Round 3 part B: the US collection letters (lib/us-collection-letters):
 * prove the debt, stop contacting me, medical bill. Built in the browser;
 * what's typed never leaves it. Draft marker + caution beside the letter,
 * never in what is copied or sent (forSending strips the DRAFT line).
 */
import { useState, type CSSProperties } from 'react';
import { LBracket, LField, LSectionHeader, L_T } from '@/components/ledger/primitives';
import { DraftLegalMarker } from '@/components/legal/DraftLegalMarker';
import { DRAFT_MARK, forSending } from '@/lib/distress-triage';
import { getCountryToday, localIsoDate } from '@/lib/today';
import {
  US_COLLECTION_FIELDS, US_COLLECTION_HOW, US_COLLECTION_SOURCES, US_COLLECTION_TITLES,
  usCollectionLetter, usCollectionMissing, validationDeadline, type UsCollectionKind, type UsCollectionValues,
} from '@/lib/us-collection-letters';

const body: CSSProperties = { fontSize: 'var(--fs-body)', lineHeight: 1.6 };
const caption: CSSProperties = { fontSize: 'var(--fs-label)', fontFamily: 'var(--font-mono)', letterSpacing: '0.12em', color: L_T.muted, display: 'block', marginBottom: 4 };

export function UsCollectionLetter({ kind }: { kind: UsCollectionKind }) {
  const [values, setValues] = useState<UsCollectionValues>({});
  const [received, setReceived] = useState('');
  const [said, setSaid] = useState('');
  const letter = usCollectionLetter(kind, values);
  const missing = usCollectionMissing(kind, values);
  const today = localIsoDate(getCountryToday('US'));
  const deadline = kind === 'debt_validation' ? validationDeadline(received, today) : null;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(forSending(letter));
      setSaid('Letter copied. Print it, sign it and send it by certified mail.');
    } catch {
      setSaid('Couldn’t copy here. Select the letter and copy it by hand.');
    }
  };
  const download = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([forSending(letter)], { type: 'text/plain;charset=utf-8' }));
    a.download = `${kind.replace(/_/g, '-')}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    setSaid(`Saved as ${a.download}.`);
  };
  return (
    <>
      <section aria-labelledby="usc-letter" data-testid={`usl-${kind}`}>
        <LSectionHeader step={1}><span id="usc-letter">{US_COLLECTION_TITLES[kind].toUpperCase()}</span></LSectionHeader>
        <DraftLegalMarker id="letter-us-collections" />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
          {US_COLLECTION_FIELDS[kind].map((f) => (
            <LField key={f.key} label={f.label} value={values[f.key] ?? ''} placeholder={f.placeholder}
              onChange={(v) => setValues((cur) => ({ ...cur, [f.key]: v }))} testId={`usl-f-${f.key}`} />
          ))}
        </div>
        {missing.length > 0 && <p style={{ ...body, color: L_T.muted }} data-testid="usl-missing">Still needed: {missing.join(', ')}.</p>}
        <label htmlFor="usc-text" style={{ ...caption, marginTop: 12 }}>The letter (read it before you send it)</label>
        <textarea id="usc-text" readOnly value={letter} rows={16} data-testid="usl-text"
          style={{ width: '100%', fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-dense)', lineHeight: 1.5, padding: 10, border: `1px solid ${L_T.ruleSoft}` }} />
        <p style={{ ...body, color: L_T.accent, margin: '6px 0' }} role="note" data-testid="letter-caution">{DRAFT_MARK}</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginTop: 6 }}>
          <LBracket onClick={copy} accent>COPY THE LETTER</LBracket>
          <LBracket onClick={download}>DOWNLOAD (.TXT)</LBracket>
          <LBracket href={`mailto:?subject=${encodeURIComponent(US_COLLECTION_TITLES[kind])}&body=${encodeURIComponent(forSending(letter))}`}>OPEN IN EMAIL</LBracket>
        </div>
        <p role="status" aria-live="polite" style={{ fontSize: 'var(--fs-small)', color: L_T.positive, minHeight: 16, margin: '6px 0 0' }} data-testid="usl-said">{said}</p>
      </section>
      <section aria-labelledby="usc-send" data-testid="usl-how-to-send">
        <LSectionHeader step={2}><span id="usc-send">WHERE AND HOW TO SEND IT</span></LSectionHeader>
        {kind === 'debt_validation' && (
          <label style={{ display: 'block', marginBottom: 8 }}>
            <span style={caption}>Day their first notice reached you</span>
            <input type="date" value={received} onChange={(e) => setReceived(e.target.value)} data-testid="usl-received-on" style={{ minHeight: 44 }} />
          </label>
        )}
        {deadline && (
          <p style={body} data-testid="usl-validation-deadline">
            {deadline.past
              ? `The 30 days ended on ${deadline.by}. You can still ask them to prove it, but they don’t have to pause collecting while they do.`
              : `Send it by ${deadline.by} (30 days after their notice reached you) so they must pause collecting until they verify.`}
          </p>
        )}
        <ul style={{ ...body, paddingLeft: 18, margin: 0 }}>
          {US_COLLECTION_HOW[kind].map((t) => <li key={t}>{t}</li>)}
        </ul>
        <p style={{ fontSize: 'var(--fs-small)', color: L_T.muted }}>
          Sources:{' '}
          {US_COLLECTION_SOURCES.map((u, i) => (
            <span key={u}>{i > 0 ? ' · ' : ''}<a href={u} rel="noopener noreferrer" target="_blank">{u.replace(/^https:\/\/(www\.)?/, '')}</a></span>
          ))}
        </p>
      </section>
    </>
  );
}
