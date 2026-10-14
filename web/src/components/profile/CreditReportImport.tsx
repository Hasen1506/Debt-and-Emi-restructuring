'use client';

/**
 * "Import from your credit report" (G6, grill #17 / #56).
 *
 * The user downloads their own free report from a bureau and uploads the PDF
 * here with its password (or pastes the report's text). The API reads it
 * (POST /api/credit-report/read): on RightDue's server, by fixed rules, never
 * stored, the password used once and never kept. Every account comes back with
 * the line it was read from. The user ticks the ones to add; each lands in the
 * Profile form for them to check and complete (the report has no rate type or
 * prepayment fee, and often no EMI or rate). Nothing is saved until they save
 * the Profile.
 */
import { useState } from 'react';
import { api, ApiFieldError, type LoanPayload } from '@/lib/api';
import { bytesToBase64 } from '@/lib/kfs';
import {
  BUREAU_LINKS,
  EXPERIAN_STEPS,
  loanFromAccount,
  matchExistingLoan,
  mergePatch,
  missingSentence,
  type CreditReportReadResponse,
} from '@/lib/credit-report';
import { loanLabel } from '@/lib/loan-types';

const MAX_PDF = 4 * 1024 * 1024;

const TYPE_LABEL: Record<string, string> = {
  home_loan: 'Home loan',
  auto_loan: 'Auto loan',
  personal_loan: 'Personal loan',
  credit_card: 'Credit card',
  education_loan: 'Education loan',
  gold_loan: 'Gold loan',
  bnpl: 'Buy now, pay later',
};

function rupees(v: string | null | undefined): string {
  if (!v) return '—';
  const n = Number(v);
  return Number.isFinite(n) ? `₹${n.toLocaleString('en-IN')}` : v;
}

const FIELD_WORD: Record<string, string> = {
  outstanding: 'balance', scheduled_emi: 'EMI', nominal_rate: 'rate', tenure_months_remaining: 'months left',
  account_last4: 'account digits', balance_as_of: 'balance date',
};

export function CreditReportImport({
  blankLoan,
  todayIso,
  onAdd,
  existing = [],
  onUpdate,
  startOpen = false,
  onClose,
}: {
  blankLoan: () => LoanPayload;
  todayIso: string;
  onAdd: (loans: LoanPayload[]) => void;
  /** The loans already in the form: an account that matches one is offered as an
   *  update, unticked, never added twice (UX50 D-03). */
  existing?: LoanPayload[];
  onUpdate?: (index: number, patch: Partial<LoanPayload>) => void;
  startOpen?: boolean;
  /** Called on Close and on "Type my loans in" (setup goes back to the manual fields). */
  onClose?: () => void;
}) {
  const [open, setOpen] = useState(startOpen);
  const [showPw, setShowPw] = useState(false);
  const [guide, setGuide] = useState(false);
  const [noAccounts, setNoAccounts] = useState(false);
  // For accounts that match a loan already in the list: 'update' | 'new' | 'skip' (default skip).
  const [choice, setChoice] = useState<Record<number, 'update' | 'new' | 'skip'>>({});
  const [text, setText] = useState('');
  const [password, setPassword] = useState('');
  const [needsPassword, setNeedsPassword] = useState(false);
  const [file, setFile] = useState<Uint8Array | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CreditReportReadResponse | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());

  function reset() {
    setText('');
    setPassword('');
    setNeedsPassword(false);
    setFile(null);
    setError(null);
    setResult(null);
    setPicked(new Set());
    setChoice({});
    setNoAccounts(false);
  }

  function close() {
    reset();
    setOpen(false);
    onClose?.();
  }

  const matches = (result?.accounts ?? []).map((a) => (a.loan ? matchExistingLoan(a.loan, existing) : -1));

  async function read(req: { text?: string; pdf_base64?: string; password?: string }) {
    setBusy(true);
    setError(null);
    try {
      const res = await api.creditReportRead({ ...req, as_of: todayIso });
      setResult(res);
      // Pre-tick only accounts that aren't already in the list (UX50 D-03).
      setPicked(new Set(res.accounts
        .map((a, i) => (a.loan && matchExistingLoan(a.loan, existing) < 0 ? i : -1))
        .filter((i) => i >= 0)));
      setPassword(''); // used once; not kept in the form either
    } catch (e) {
      if (e instanceof ApiFieldError && e.field === 'password') setNeedsPassword(true);
      const msg = e instanceof Error ? e.message : 'The report could not be read.';
      setNoAccounts(/couldn.t read the accounts/i.test(msg));
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  async function onFile(f: File | undefined) {
    if (!f) return;
    if (f.size > MAX_PDF) {
      setError('The PDF is larger than 4 MB. Download the report again, or type your loans in.');
      return;
    }
    const bytes = new Uint8Array(await f.arrayBuffer());
    setFile(bytes);
    await read({ pdf_base64: bytesToBase64(bytes) });
  }

  function add() {
    if (!result) return;
    const loans: LoanPayload[] = [];
    result.accounts.forEach((a, i) => {
      if (!a.loan) return;
      const m = matches[i];
      const incoming = loanFromAccount(a.loan, blankLoan(), todayIso);
      if (m >= 0) {
        const c = choice[i] ?? 'skip';
        if (c === 'new') loans.push(incoming);
        if (c === 'update' && onUpdate) {
          const patch: Partial<LoanPayload> = {};
          for (const d of mergePatch(existing[m], incoming)) (patch as Record<string, unknown>)[d.field] = incoming[d.field];
          onUpdate(m, patch);
        }
      } else if (picked.has(i)) {
        loans.push(incoming);
      }
    });
    onAdd(loans);
    reset();
    setOpen(false);
  }

  const updates = Object.values(choice).filter((c) => c === 'update').length;
  const adds = picked.size + Object.values(choice).filter((c) => c === 'new').length;

  if (!open) {
    return (
      <button type="button" className="btn-ghost" data-testid="cr-open" onClick={() => setOpen(true)}>
        Import from your credit report (CIBIL, Experian, CRIF, Equifax) · beta
      </button>
    );
  }

  return (
    <section
      data-testid="cr-import"
      style={{ border: '1px solid var(--border)', borderRadius: 6, padding: 12, display: 'grid', gap: 10 }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
        <strong>Fill from your credit report <span className="muted" style={{ fontSize: 11 }}>BETA · works with most CIBIL and Experian PDFs</span></strong>
        <button type="button" className="btn-ghost" data-testid="cr-close" onClick={close}>
          Close
        </button>
      </div>
      <p className="muted" style={{ margin: 0, fontSize: 12, lineHeight: 1.5 }}>
        Your free credit report lists every loan and card in your name, even ones you&apos;ve forgotten. Upload
        it and we&apos;ll fill in what it shows; you check each one. It is read on RightDue&apos;s server by fixed
        rules, then deleted: never stored or shared. Your name, PAN and date of birth are not read into the app.
      </p>

      <div style={{ fontSize: 12 }}>
        <button type="button" className="btn-ghost" data-testid="cr-guide-open" aria-expanded={guide} onClick={() => setGuide(!guide)}>
          Don&apos;t have it? Get it free from Experian in about 3 minutes
        </button>
        {guide && (
          <div data-testid="cr-guide" style={{ display: 'grid', gap: 4, marginTop: 6 }}>
            <ol style={{ margin: 0, paddingLeft: 18 }}>
              {EXPERIAN_STEPS.map((st) => <li key={st}>{st}</li>)}
            </ol>
            <span>
              {BUREAU_LINKS.map((b, i) => (
                <span key={b.name}>
                  {i > 0 && ' · '}
                  <a href={b.url} target="_blank" rel="noreferrer">{b.name}</a> ({b.note})
                </span>
              ))}
            </span>
          </div>
        )}
      </div>

      {busy && (
        <p className="muted" role="status" data-testid="cr-progress" style={{ margin: 0, fontSize: 12 }}>
          Reading your report on our server (up to 15 seconds; the first try after a quiet spell can take longer).
        </p>
      )}

      {!result && (
        <>
          <label style={{ fontSize: 13 }}>
            PDF{' '}
            <input
              type="file"
              accept="application/pdf,.pdf"
              data-testid="cr-file"
              disabled={busy}
              onChange={(e) => onFile(e.target.files?.[0])}
            />
          </label>
          {needsPassword && file && (
            <div style={{ display: 'grid', gap: 4 }}>
              <label style={{ fontSize: 13, display: 'grid', gap: 4 }}>
                The PDF&apos;s password
                <input
                  type={showPw ? 'text' : 'password'}
                  autoComplete="off"
                  data-testid="cr-password"
                  value={password}
                  maxLength={64}
                  aria-describedby="cr-pw-help cr-pw-error"
                  onChange={(e) => setPassword(e.target.value)}
                />
              </label>
              <label style={{ fontSize: 12 }}>
                <input type="checkbox" data-testid="cr-show-password" checked={showPw} onChange={(e) => setShowPw(e.target.checked)} />{' '}
                Show password
              </label>
              {error && (
                <p id="cr-pw-error" role="alert" data-testid="cr-error" style={{ margin: 0, fontSize: 13, color: 'var(--danger, #b00020)' }}>
                  {error}
                </p>
              )}
              <span id="cr-pw-help" className="muted" style={{ fontSize: 12 }}>
                The bureau&apos;s download page or email says which format it uses. It is used once to open the
                file and never kept.
              </span>
              <button
                type="button"
                className="btn btn-primary"
                data-testid="cr-unlock"
                disabled={busy || !password}
                onClick={() => read({ pdf_base64: bytesToBase64(file), password })}
              >
                {busy ? 'Opening…' : 'Open the report'}
              </button>
            </div>
          )}
          <label style={{ fontSize: 13, display: 'grid', gap: 4 }}>
            Or paste the report&apos;s text
            <textarea
              rows={5}
              data-testid="cr-text"
              value={text}
              disabled={busy}
              onChange={(e) => setText(e.target.value)}
            />
          </label>
          <button
            type="button"
            className="btn-ghost"
            disabled={busy || !text.trim()}
            onClick={() => read({ text })}
          >
            {busy ? 'Reading…' : 'Read the text'}
          </button>
        </>
      )}

      {error && !(needsPassword && file && !result) && (
        <div role="alert" data-testid="cr-error" style={{ display: 'grid', gap: 6, fontSize: 13 }}>
          <p style={{ margin: 0, color: 'var(--danger, #b00020)' }}>{error}</p>
          {noAccounts && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button type="button" className="btn-ghost" data-testid="cr-paste-instead"
                onClick={() => document.querySelector<HTMLTextAreaElement>('[data-testid="cr-text"]')?.focus()}>
                Paste the report&apos;s text
              </button>
              <button type="button" className="btn-ghost" data-testid="cr-type-instead" onClick={close}>
                Type my loans in
              </button>
            </div>
          )}
        </div>
      )}

      {result && (
        <div data-testid="cr-result" style={{ display: 'grid', gap: 8 }}>
          <p style={{ margin: 0, fontSize: 13 }}>
            {result.bureau_name ?? 'Credit report'}
            {result.report_date ? `, dated ${result.report_date.value}` : ''}
            {result.score ? ` · score ${result.score.value}` : ''}: {result.accounts.length} account
            {result.accounts.length === 1 ? '' : 's'}, {result.open_loans} you can add.
          </p>
          {result.warnings.map((w) => (
            <p key={w} className="muted" style={{ margin: 0, fontSize: 12 }}>{w}</p>
          ))}
          {result.accounts.map((a, i) => {
            const f = a.fields;
            return (
              <label
                key={i}
                data-testid="cr-account"
                style={{
                  display: 'grid', gap: 2, padding: 8, border: '1px solid var(--border)', borderRadius: 6,
                  opacity: a.loan ? 1 : 0.7, fontSize: 13,
                }}
              >
                {matches[i] >= 0 && a.loan && (
                  <span data-testid="cr-duplicate" style={{ fontSize: 12, display: 'grid', gap: 4 }}>
                    <strong>Already in your loans: {loanLabel(existing[matches[i]])}.</strong>
                    {mergePatch(existing[matches[i]], loanFromAccount(a.loan, blankLoan(), todayIso))
                      .filter((d) => d.field !== 'balance_as_of')
                      .map((d) => (
                        <span key={d.field} className="muted">
                          {FIELD_WORD[d.field] ?? d.field}: {d.from ? (d.field === 'outstanding' || d.field === 'scheduled_emi' ? rupees(d.from) : d.from) : 'empty'} →{' '}
                          {d.field === 'outstanding' || d.field === 'scheduled_emi' ? rupees(d.to) : d.to}
                        </span>
                      ))}
                    <span style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                      {(['skip', 'update', 'new'] as const).map((c) => (
                        <label key={c}>
                          <input
                            type="radio"
                            name={`cr-dup-${i}`}
                            data-testid={`cr-dup-${c}`}
                            checked={(choice[i] ?? 'skip') === c}
                            disabled={c === 'update' && !onUpdate}
                            onChange={() => setChoice({ ...choice, [i]: c })}
                          />{' '}
                          {c === 'skip' ? 'Leave it' : c === 'update' ? 'Update it' : 'Add as new'}
                        </label>
                      ))}
                    </span>
                  </span>
                )}
                <span>
                  <input
                    type="checkbox"
                    disabled={!a.loan || matches[i] >= 0}
                    checked={picked.has(i)}
                    onChange={(e) => {
                      const next = new Set(picked);
                      if (e.target.checked) next.add(i); else next.delete(i);
                      setPicked(next);
                    }}
                  />{' '}
                  <strong>{f.lender?.value}</strong> · {a.loan_type ? TYPE_LABEL[a.loan_type] : f.account_type?.value ?? 'Account'}
                  {f.account_number ? ` · ${f.account_number.value}` : ''}
                  {!a.is_open ? ' · closed' : ''}
                </span>
                <span className="muted" style={{ fontSize: 12 }}>
                  Balance {rupees(f.balance?.value)}
                  {f.emi ? ` · EMI ${rupees(f.emi.value)}` : ''}
                  {f.rate ? ` · ${Math.round(Number(f.rate.value) * 10000) / 100}%` : ''}
                  {f.credit_limit ? ` · limit ${rupees(f.credit_limit.value)}` : ''}
                  {f.sanctioned ? ` · sanctioned ${rupees(f.sanctioned.value)}` : ''}
                  {f.reported ? ` · as of ${f.reported.value}` : ''}
                </span>
                {f.balance && (
                  <span className="muted" style={{ fontSize: 11 }}>From your report: &ldquo;{f.balance.source}&rdquo;</span>
                )}
                {f.account_type?.note && <span style={{ fontSize: 12 }}>{f.account_type.note}</span>}
                {a.flags.map((fl) => (
                  <span key={fl} style={{ fontSize: 12 }}>{fl}</span>
                ))}
                {a.loan && missingSentence(a.loan) && (
                  <span className="muted" style={{ fontSize: 12 }}>{missingSentence(a.loan)}</span>
                )}
              </label>
            );
          })}
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="btn btn-primary" data-testid="cr-add" disabled={!adds && !updates} onClick={add}>
              {adds ? `Add ${adds} to my loans` : ''}
              {adds && updates ? ', ' : ''}
              {updates ? `update ${updates}` : ''}
              {!adds && !updates ? 'Add 0 to my loans' : ''}
            </button>
            <button type="button" className="btn-ghost" onClick={reset}>
              Start again
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
