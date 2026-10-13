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
  loanFromAccount,
  missingSentence,
  type CreditReportReadResponse,
} from '@/lib/credit-report';

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

export function CreditReportImport({
  blankLoan,
  todayIso,
  onAdd,
}: {
  blankLoan: () => LoanPayload;
  todayIso: string;
  onAdd: (loans: LoanPayload[]) => void;
}) {
  const [open, setOpen] = useState(false);
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
  }

  async function read(req: { text?: string; pdf_base64?: string; password?: string }) {
    setBusy(true);
    setError(null);
    try {
      const res = await api.creditReportRead({ ...req, as_of: todayIso });
      setResult(res);
      setPicked(new Set(res.accounts.map((a, i) => (a.loan ? i : -1)).filter((i) => i >= 0)));
      setPassword(''); // used once; not kept in the form either
    } catch (e) {
      if (e instanceof ApiFieldError && e.field === 'password') setNeedsPassword(true);
      setError(e instanceof Error ? e.message : 'The report could not be read.');
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
    const loans = result.accounts
      .map((a, i) => (picked.has(i) && a.loan ? a.loan : null))
      .filter((l): l is NonNullable<typeof l> => l !== null)
      .map((l) => ({
        ...loanFromAccount(l, blankLoan(), todayIso),
        imported_from: 'credit_report' as const,
        ...(l.account_last4 ? { account_last4: l.account_last4 } : {}),
      }));
    onAdd(loans);
    reset();
    setOpen(false);
  }

  if (!open) {
    return (
      <button type="button" className="btn-ghost" data-testid="cr-open" onClick={() => setOpen(true)}>
        Import from your credit report (CIBIL, Experian, CRIF, Equifax)
      </button>
    );
  }

  return (
    <section
      data-testid="cr-import"
      style={{ border: '1px solid var(--border)', borderRadius: 6, padding: 12, display: 'grid', gap: 10 }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
        <strong>Import from your credit report</strong>
        <button type="button" className="btn-ghost" onClick={() => { reset(); setOpen(false); }}>
          Close
        </button>
      </div>
      <p className="muted" style={{ margin: 0, fontSize: 12, lineHeight: 1.5 }}>
        A credit report is the list a credit bureau (a company licensed by RBI to keep everyone&apos;s loan
        records) holds on you: every loan and card in your name. Each bureau gives you one free report a year:{' '}
        {BUREAU_LINKS.map((b, i) => (
          <span key={b.name}>
            {i > 0 && ', '}
            <a href={b.url} target="_blank" rel="noreferrer">{b.name}</a>
          </span>
        ))}
        . Download the PDF there and upload it here. It is read on RightDue&apos;s server by fixed rules, never
        stored, and not sent to anyone else. Your name, PAN and date of birth on it are not read into the app.
        You tick and check every loan before it goes in.
      </p>

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
                  type="password"
                  autoComplete="off"
                  data-testid="cr-password"
                  value={password}
                  maxLength={64}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </label>
              <span className="muted" style={{ fontSize: 12 }}>
                The bureau&apos;s download page or email says which format it uses: often your date of birth as
                DDMMYYYY, or the first four letters of your name with your birth year or the last four digits
                of your mobile. It is used once to open the file and never kept.
              </span>
              <button
                type="button"
                className="btn-primary"
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

      {error && (
        <p role="alert" data-testid="cr-error" style={{ margin: 0, fontSize: 13, color: 'var(--danger, #b00020)' }}>
          {error}
        </p>
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
                <span>
                  <input
                    type="checkbox"
                    disabled={!a.loan}
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
            <button type="button" className="btn-primary" data-testid="cr-add" disabled={!picked.size} onClick={add}>
              Add {picked.size} to my loans
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
