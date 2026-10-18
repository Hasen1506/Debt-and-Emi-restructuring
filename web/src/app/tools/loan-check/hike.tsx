'use client';

/**
 * Loan Check for the hike cycle (audit 80+ A11, A16).
 *
 * RBI raised the repo rate 25 bps to 5.50% on 7 Oct 2026. The screen now
 * leads with what a rise does to the loan (new EMI or new tenure, and the
 * choice the lender must offer), checks whether rises reached the loan
 * faster than cuts, writes a letter when the EMI was raised without the
 * choice, and ends every result with a bridge to the plan and an
 * amount-free share.
 */
import { useState } from 'react';
import { MonthYearPicker } from '@/components/MonthYearPicker';
import { Field } from '@/components/ToolPrimitives';
import { LBracket, LChip, LChipRow, L_T } from '@/components/ledger/primitives';
import { LNote, LStep, LStepSub } from '@/components/ledger/LToolSteps';
import {
  api,
  formatCurrency,
  formatPct,
  type ComplaintLetter,
  type LoanBankAction,
  type LoanCheckPassThrough,
  type LoanCheckRateRise,
  type LoanCheckRequest,
  type LoanCheckResponse,
} from '@/lib/api';
import {
  PLAN_HREF,
  bridgeLine,
  impactRows,
  shareText,
  whatsappHref,
  type HistoryRow,
} from '@/lib/loan-check-hike';
import { DraftLegalMarker } from '@/components/legal/DraftLegalMarker';
import { formatIso } from '@/lib/today';

const inr = (v: string) => formatCurrency(v, 'INR');
const day = (iso: string) => formatIso(iso);

// ── form pieces ────────────────────────────────────────────────────────────

export function HikeQuestions({
  action,
  onAction,
  offered,
  onOffered,
}: {
  action: LoanBankAction;
  onAction: (a: LoanBankAction) => void;
  offered: 'yes' | 'no' | 'unsure';
  onOffered: (o: 'yes' | 'no' | 'unsure') => void;
}) {
  const changed = action === 'emi_raised' || action === 'tenure_extended' || action === 'both';
  return (
    <div data-testid="lc-hike-questions" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <LChipRow label="After the RBI's latest rate rise, what did your lender do?">
        <LChip on={action === 'none_yet'} onClick={() => onAction('none_yet')}>Nothing yet</LChip>
        <LChip on={action === 'emi_raised'} onClick={() => onAction('emi_raised')}>Raised my EMI</LChip>
        <LChip on={action === 'tenure_extended'} onClick={() => onAction('tenure_extended')}>Extended my tenure</LChip>
        <LChip on={action === 'both'} onClick={() => onAction('both')}>Both</LChip>
        <LChip on={action === 'unknown'} onClick={() => onAction('unknown')}>Not sure</LChip>
      </LChipRow>
      {changed && (
        <LChipRow label="Did it offer you the choice (a higher EMI, a longer tenure, or prepaying) first?">
          <LChip on={offered === 'yes'} onClick={() => onOffered('yes')}>Yes</LChip>
          <LChip on={offered === 'no'} onClick={() => onOffered('no')}>No</LChip>
          <LChip on={offered === 'unsure'} onClick={() => onOffered('unsure')}>Not sure</LChip>
        </LChipRow>
      )}
    </div>
  );
}

/** Rate changes off statements or rate-change letters, for rises vs cuts. */
export function RateHistoryRows({
  rows,
  onChange,
  error,
}: {
  rows: HistoryRow[];
  onChange: (rows: HistoryRow[]) => void;
  error?: string | null;
}) {
  const set = (i: number, patch: Partial<HistoryRow>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <div data-testid="lc-rate-history" style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 520 }}>
      <LStepSub>Your rate changes (optional)</LStepSub>
      <p style={{ margin: 0, fontSize: 'var(--fs-dense)', color: L_T.muted, lineHeight: 1.6 }}>
        Each time your rate moved: the month and the new rate, from your statements or the bank&apos;s
        SMS. We check whether rises reached your loan faster than cuts.
      </p>
      {rows.map((r, i) => (
        <div key={i} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 120px) auto', gap: 8, alignItems: 'end' }}>
          <MonthYearPicker label={`Change ${i + 1}: month`} value={r.month} onChange={(v) => set(i, { month: v })} minYear={2019} optional />
          <Field label="New rate (%)" value={r.rate} onChange={(v) => set(i, { rate: v })} placeholder="8.40" />
          <LBracket onClick={() => onChange(rows.filter((_, j) => j !== i))} label={`Remove change ${i + 1}`}>
            REMOVE
          </LBracket>
        </div>
      ))}
      {rows.length < 60 && (
        <div>
          <LBracket onClick={() => onChange([...rows, { month: '', rate: '' }])}>+ ADD A RATE CHANGE</LBracket>
        </div>
      )}
      {error && <p role="alert" style={{ margin: 0, fontSize: 'var(--fs-dense)', color: L_T.negative }}>{error}</p>}
    </div>
  );
}

// ── result pieces ──────────────────────────────────────────────────────────

/** A11a: the new EMI or the new tenure, side by side. */
export function RateRiseCard({ rr }: { rr: LoanCheckRateRise }) {
  const im = rr.impact;
  const rows = impactRows(im);
  const when =
    rr.status === 'applied'
      ? `Your rate already carries it: ${formatPct(im.rate_before, 2)} → ${formatPct(im.rate_after, 2)}.`
      : rr.status === 'pending'
        ? `It should reach your rate by about ${rr.reach_by ? day(rr.reach_by) : 'three months after the decision'}: ${formatPct(im.rate_before, 2)} → ${formatPct(im.rate_after, 2)}.`
        : `If your lender passes on the full rise: ${formatPct(im.rate_before, 2)} → ${formatPct(im.rate_after, 2)}.`;
  return (
    <LStep no="03" id="lc-rise" title="Rate up: your new EMI or tenure" answer>
      <div data-testid="lc-rate-rise">
        <p style={{ fontSize: 'var(--fs-body)', margin: '0 0 6px', lineHeight: 1.6 }}>
          The RBI raised the repo rate from {formatPct(rr.repo_from, 2)} to {formatPct(rr.repo_to, 2)} on {day(rr.decided)}. {when}
        </p>
        <div role="region" aria-label="Your choices after the rate rise" tabIndex={0} style={{ overflowX: 'auto', marginTop: 10 }}>
          <table style={{ borderCollapse: 'collapse', fontSize: 'var(--fs-dense)', minWidth: 320, width: '100%' }}>
            <caption style={{ textAlign: 'left', fontSize: 'var(--fs-small)', color: L_T.muted, paddingBottom: 6 }}>
              Worked on today&apos;s balance of {inr(im.outstanding)}; interest is the change over the rest of the loan.
            </caption>
            <thead>
              <tr>
                <th scope="col" style={th}>Choice</th>
                <th scope="col" style={th}>EMI</th>
                <th scope="col" style={th}>Months</th>
                <th scope="col" style={th}>Interest</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.option}>
                  <th scope="row" style={{ ...td, fontWeight: 600 }}>{r.option}</th>
                  <td className="num" style={td}>{r.monthly}</td>
                  <td className="num" style={td}>{r.months}</td>
                  <td className="num" style={td}>{r.interest}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {im.tenure_premium && Number(im.tenure_premium) > 0 && (
          <p data-testid="lc-best-step" style={{ fontSize: 'var(--fs-dense)', margin: '10px 0 0', lineHeight: 1.6 }}>
            <strong>Best step:</strong> if you can afford {inr(im.emi_change)} more a month, raise the EMI: it costs{' '}
            {inr(im.tenure_premium)} less interest than a longer tenure. If cash is tight, keep the EMI and take the
            longer tenure. Either way it is your choice, and your lender must offer it.
          </p>
        )}
      </div>
    </LStep>
  );
}

/** A11c: when each repo move reached the loan. */
export function PassThroughCard({ pt }: { pt: LoanCheckPassThrough }) {
  return (
    <details data-testid="lc-pass-through" style={{ border: `1px solid ${L_T.ruleSoft}`, padding: '12px 16px', fontSize: 'var(--fs-dense)' }} open={pt.asymmetric}>
      <summary style={{ cursor: 'pointer', letterSpacing: '0.12em', fontSize: 'var(--fs-label)', fontFamily: 'var(--font-mono)' }}>
        RISES VS CUTS: WHEN EACH RBI MOVE REACHED YOUR LOAN
      </summary>
      <div role="region" aria-label="When each RBI move reached your loan" tabIndex={0} style={{ overflowX: 'auto', marginTop: 10 }}>
        <table style={{ borderCollapse: 'collapse', fontSize: 'var(--fs-dense)', minWidth: 320 }}>
          <thead>
            <tr>
              <th scope="col" style={th}>RBI decision</th>
              <th scope="col" style={th}>Move</th>
              <th scope="col" style={th}>Reached your loan</th>
              <th scope="col" style={th}>Months</th>
            </tr>
          </thead>
          <tbody>
            {pt.moves.map((m) => {
              const cut = Number(m.repo_to) < Number(m.repo_from);
              return (
                <tr key={m.decided}>
                  <td style={td}>{day(m.decided)}</td>
                  <td className="num" style={{ ...td, color: cut ? L_T.positive : L_T.negative }}>
                    {cut ? 'cut ' : 'rise '}
                    {formatPct(String(Math.abs(Number(m.repo_to) - Number(m.repo_from))), 2)}
                  </td>
                  <td style={td}>{m.reached ? day(m.reached) : 'not in your history'}</td>
                  <td className="num" style={{ ...td, color: m.late_months > 0 && cut ? L_T.negative : undefined }}>
                    {m.lag_months ?? '—'}
                    {m.late_months > 0 && cut ? ` (${m.late_months} past the 3-month window)` : ''}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {pt.notes.map((n) => (
        <p key={n} style={{ margin: '8px 0 0', color: L_T.muted }}>{n}</p>
      ))}
    </details>
  );
}

/** A11 letter: the EMI or tenure was changed without the choice. */
export function ResetChoicePanel({ request }: { request: LoanCheckRequest }) {
  const [pref, setPref] = useState<'emi' | 'tenure' | 'undecided'>('undecided');
  const [name, setName] = useState('');
  const [account, setAccount] = useState('');
  const [letter, setLetter] = useState<ComplaintLetter | null>(null);
  const [notice, setNotice] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  async function write() {
    setBusy(true);
    setErr(null);
    try {
      const res = await api.resetChoiceLetter({ ...request, preference: pref });
      setLetter(res.letter);
      setNotice(res.draft_notice);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not write the letter. Try again.');
    } finally {
      setBusy(false);
    }
  }
  // Name and account are filled in here, in the browser; they never go to the server.
  const text = letter
    ? letter.text
        .replaceAll('[Full name]', name.trim() || '[Full name]')
        .replaceAll('[Loan account number]', account.trim() || '[Loan account number]')
    : '';
  return (
    <LStep no="04" id="lc-reset-letter" title="Letter: EMI or tenure changed without your choice">
      <div data-testid="lc-reset-choice">
        <DraftLegalMarker id="letter-rate-reset" />
        <LNote>
          Asks your lender to set out the options in writing and apply the one you choose. It claims no money, so
          it is quick for the lender to fix.
        </LNote>
        <LChipRow label="What would you like applied?">
          <LChip on={pref === 'emi'} onClick={() => setPref('emi')}>Higher EMI, same end date</LChip>
          <LChip on={pref === 'tenure'} onClick={() => setPref('tenure')}>Same EMI, longer tenure</LChip>
          <LChip on={pref === 'undecided'} onClick={() => setPref('undecided')}>Send me the options first</LChip>
        </LChipRow>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10, marginTop: 10 }}>
          <Field label="Your name (stays in this browser)" value={name} onChange={setName} />
          <Field label="Loan account number (stays in this browser)" value={account} onChange={setAccount} />
        </div>
        <p style={{ margin: '10px 0 0' }}>
          <LBracket onClick={write} accent>{busy ? 'WRITING…' : letter ? 'REWRITE THE LETTER' : 'WRITE THE LETTER'}</LBracket>
        </p>
        {err && <p role="alert" style={{ color: L_T.negative, fontSize: 'var(--fs-dense)' }}>{err}</p>}
        {letter && (
          <>
            <p role="note" style={{ fontSize: 'var(--fs-dense)', color: L_T.accent, margin: '12px 0 6px' }}>{notice}</p>
            <pre
              data-testid="lc-reset-letter-text"
              style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', fontSize: 'var(--fs-dense)', lineHeight: 1.6, border: `1px solid ${L_T.ruleSoft}`, padding: 12, margin: 0 }}
            >
              {text}
            </pre>
            <p style={{ margin: '8px 0 0' }}>
              <LBracket
                onClick={() => {
                  void navigator.clipboard?.writeText(text).then(() => setCopied(true));
                }}
              >
                {copied ? 'COPIED' : 'COPY THE LETTER'}
              </LBracket>
            </p>
          </>
        )}
      </div>
    </LStep>
  );
}

/** A16: after any result, the bridge to the plan and an amount-free share. */
export function PlanBridge({ r }: { r: LoanCheckResponse }) {
  return (
    <section
      data-testid="lc-bridge"
      aria-label="Keep watching this loan"
      style={{ border: `1px dashed ${L_T.ink}`, padding: '14px 16px', fontSize: 'var(--fs-body)', lineHeight: 1.6 }}
    >
      <p style={{ margin: 0 }}>{bridgeLine(r)}</p>
      <p style={{ margin: '8px 0 0', display: 'flex', flexWrap: 'wrap', gap: 14 }}>
        <a data-testid="lc-start-plan" href={PLAN_HREF} style={{ color: L_T.accent, fontWeight: 700 }}>
          <span aria-hidden="true">[</span>START YOUR PLAN (2 MINUTES) →<span aria-hidden="true">]</span>
        </a>
        <a
          data-testid="lc-share-whatsapp"
          href={whatsappHref(shareText('loan-check'))}
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: L_T.accent }}
        >
          <span aria-hidden="true">[</span>SEND TO A FRIEND WITH A HOME LOAN (WHATSAPP)<span aria-hidden="true">]</span>
        </a>
      </p>
      <p style={{ margin: '6px 0 0', fontSize: 'var(--fs-small)', color: L_T.muted }}>
        The message has no amounts, rates or lender name: only a link to this free check.
      </p>
    </section>
  );
}

const th: React.CSSProperties = {
  textAlign: 'left',
  padding: '6px 12px 6px 0',
  borderBottom: '1px solid var(--border)',
  fontWeight: 500,
  fontSize: 'var(--fs-label)', fontFamily: 'var(--font-mono)',
  letterSpacing: '0.12em',
  color: 'var(--muted)',
};
const td: React.CSSProperties = { padding: '6px 12px 6px 0', verticalAlign: 'top' };
