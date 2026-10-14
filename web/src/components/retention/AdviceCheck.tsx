'use client';

/** A8: paste advice, see per-claim agree / disagree against your loans and RBI rules. */
import { useState } from 'react';
import { ADVICE_MAX, VERDICT_LABEL, checkAdvice, type AdviceLoan, type AdviceReport } from '@/lib/advice-check';
import { L_T, lPayBtn } from '@/components/ledger/primitives';

const COLOR = { agree: L_T.positive, disagree: L_T.negative, cant_check: L_T.muted } as const;

export function AdviceCheck({ loans, extraTarget, strategy, country }: {
  loans: AdviceLoan[]; extraTarget: number | null; strategy: string; country: 'IN' | 'US';
}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [rep, setRep] = useState<AdviceReport | null>(null);

  async function run() {
    setBusy(true);
    setErr('');
    try {
      setRep(await checkAdvice({ text, loans, extra_target: extraTarget, strategy, country }));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div id="advice-check" style={{ margin: '6px 0 10px', padding: '10px 12px', border: `1px solid ${L_T.ruleSoft}`, background: L_T.paper }}>
      <label style={{ display: 'block', fontSize: 'var(--fs-dense)', lineHeight: 1.5 }}>
        Paste the advice (from ChatGPT, Claude, Gemini, a bank RM or an app)
        <textarea
          value={text}
          maxLength={ADVICE_MAX}
          rows={5}
          onChange={(e) => setText(e.target.value)}
          placeholder="e.g. Pay off your car loan first. Don't prepay the home loan: there's a foreclosure penalty."
          style={{ display: 'block', width: '100%', boxSizing: 'border-box', marginTop: 4, fontFamily: 'inherit', fontSize: 'var(--fs-body)', padding: 8 }}
        />
      </label>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 6 }}>
        <button type="button" style={lPayBtn(true)} disabled={busy || text.trim().length < 4 || loans.length === 0} onClick={() => void run()}>
          {busy ? 'CHECKING…' : 'CHECK IT'}
        </button>
        <span style={{ fontSize: 'var(--fs-small)', color: L_T.muted }}>Checked with fixed rules and your numbers, not an AI. Nothing is saved.</span>
      </div>
      {err && <p role="alert" style={{ fontSize: 'var(--fs-dense)', color: L_T.negative }}>{err}</p>}
      {rep && (
        <div role="status" style={{ marginTop: 8 }}>
          <p style={{ fontSize: 'var(--fs-body)', fontWeight: 600, margin: '0 0 6px' }}>{rep.headline}</p>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {rep.claims.map((c, k) => (
              <li key={k} style={{ fontSize: 'var(--fs-dense)', lineHeight: 1.55, padding: '6px 0', borderTop: `1px dashed ${L_T.ruleSoft}` }}>
                <span style={{ fontWeight: 700, letterSpacing: '0.06em', color: COLOR[c.verdict] }}>{VERDICT_LABEL[c.verdict]}</span>{' '}
                <q style={{ color: L_T.inkSoft }}>{c.quote}</q>
                <div>{c.why}</div>
                {c.source && <div style={{ fontSize: 'var(--fs-small)', color: L_T.muted }}>Rule: {c.source}</div>}
              </li>
            ))}
          </ul>
          {rep.not_checked.length > 0 && (
            <p style={{ fontSize: 'var(--fs-small)', color: L_T.muted }}>Not checked (no rule we can test): {rep.not_checked.map((s) => `“${s}”`).join(' ')}</p>
          )}
        </div>
      )}
    </div>
  );
}
