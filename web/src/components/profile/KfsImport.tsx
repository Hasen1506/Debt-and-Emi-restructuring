'use client';

/**
 * "Import from Key Facts Statement / sanction letter" (roadmap PR G).
 *
 * The user uploads the KFS as a PDF or pastes its text. The API reads it
 * (POST /api/kfs/read; plain-text rules, no outside service, nothing
 * stored) and this panel shows every field it can fill, each editable and
 * marked "from your KFS", "worked out from your KFS" or "you entered", with
 * the EMI / APR cross-checks in plain words. "Add this loan" puts it in the
 * Profile form; nothing is saved until the user saves the Profile.
 */
import { useState } from 'react';
import { api, type LoanPayload, type LoanType } from '@/lib/api';
import {
  bytesToBase64,
  editRow,
  KFS_CIRCULAR,
  KFS_CIRCULAR_URL,
  loanFromReview,
  provenanceLabel,
  reviewRows,
  type KfsReadResponse,
  type ReviewRow,
} from '@/lib/kfs';

const LOAN_TYPE_OPTIONS: { value: LoanType; label: string }[] = [
  { value: 'home_loan', label: 'Home loan' },
  { value: 'auto_loan', label: 'Auto loan' },
  { value: 'personal_loan', label: 'Personal loan' },
  { value: 'education_loan', label: 'Education loan' },
  { value: 'gold_loan', label: 'Gold loan' },
];

const MAX_PDF = 4 * 1024 * 1024;

function shown(r: ReviewRow): string {
  if (r.kind === 'percent' && r.value !== '') {
    const n = Number(r.value) * 100;
    return Number.isFinite(n) ? String(Math.round(n * 10000) / 10000) : r.value;
  }
  return r.value;
}

function stored(r: ReviewRow, typed: string): string {
  if (r.kind === 'percent') {
    if (typed.trim() === '') return '';
    const n = Number(typed);
    return Number.isFinite(n) ? String(Math.round((n / 100) * 1e8) / 1e8) : typed;
  }
  return typed;
}

export function KfsImport({
  blankLoan,
  todayIso,
  onAdd,
}: {
  blankLoan: () => LoanPayload;
  todayIso: string;
  onAdd: (loan: LoanPayload) => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<KfsReadResponse | null>(null);
  const [rows, setRows] = useState<ReviewRow[]>([]);

  function reset() {
    setText('');
    setError(null);
    setResult(null);
    setRows([]);
  }

  async function read(req: { text?: string; pdf_base64?: string }) {
    setBusy(true);
    setError(null);
    try {
      const res = await api.kfsRead({ ...req, as_of: todayIso });
      setResult(res);
      setRows(reviewRows(res));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The document could not be read.');
    } finally {
      setBusy(false);
    }
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    if (file.size > MAX_PDF) {
      setError('The PDF is larger than 4 MB. Paste the KFS text instead.');
      return;
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    await read({ pdf_base64: bytesToBase64(bytes) });
  }

  if (!open) {
    return (
      <button type="button" className="btn-ghost" data-testid="kfs-open" onClick={() => setOpen(true)}>
        Import from Key Facts Statement / sanction letter
      </button>
    );
  }

  return (
    <section
      data-testid="kfs-import"
      style={{ border: '1px solid var(--border)', borderRadius: 6, padding: 12, display: 'grid', gap: 10 }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
        <strong>Import from your Key Facts Statement</strong>
        <button type="button" className="btn-ghost" onClick={() => { reset(); setOpen(false); }}>
          Close
        </button>
      </div>
      <p className="muted" style={{ margin: 0, fontSize: 12, lineHeight: 1.5 }}>
        Loans sanctioned from 1 Oct 2024 come with a Key Facts Statement stating the rate, APR and every
        charge (<a href={KFS_CIRCULAR_URL} target="_blank" rel="noreferrer">{KFS_CIRCULAR}</a>). Upload it as a
        PDF or paste its text. It is read on RightDue&apos;s server by fixed rules, not sent to anyone else,
        and not kept. You check every figure before it goes into your loans.
      </p>

      {!result && (
        <>
          <label style={{ fontSize: 13 }}>
            PDF{' '}
            <input
              type="file"
              accept="application/pdf,.pdf"
              data-testid="kfs-file"
              disabled={busy}
              onChange={(e) => onFile(e.target.files?.[0])}
            />
          </label>
          <label style={{ fontSize: 13, display: 'grid', gap: 4 }}>
            Or paste the text
            <textarea
              data-testid="kfs-text"
              rows={6}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Key Facts Statement, Part 1 (Interest rate and fees/charges) ..."
            />
          </label>
          <div>
            <button
              type="button"
              className="btn-primary"
              data-testid="kfs-read"
              disabled={busy || text.trim() === ''}
              onClick={() => read({ text })}
            >
              {busy ? 'Reading…' : 'Read it'}
            </button>
          </div>
        </>
      )}

      {error && (
        <p role="alert" style={{ margin: 0, color: 'var(--danger, #b00020)', fontSize: 13 }}>
          {error}
        </p>
      )}

      {result && (
        <div data-testid="kfs-review" style={{ display: 'grid', gap: 10 }}>
          <p className="muted" style={{ margin: 0, fontSize: 12 }}>
            Check each figure against your document and change anything that&apos;s wrong. Nothing is saved
            until you add the loan and save your profile.
          </p>
          {result.checks.length > 0 && (
            <ul data-testid="kfs-checks" style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.5 }}>
              {result.checks.map((c) => (
                <li key={c.kind} style={{ color: c.ok ? 'inherit' : 'var(--danger, #b00020)' }}>
                  {c.ok ? '✓ ' : '⚠ '}
                  {c.message}
                </li>
              ))}
            </ul>
          )}
          {result.warnings.map((w) => (
            <p key={w} className="muted" style={{ margin: 0, fontSize: 12 }}>{w}</p>
          ))}
          <div style={{ display: 'grid', gap: 8 }}>
            {rows.map((r) => (
              <div key={r.key} data-testid={`kfs-row-${r.key}`} style={{ display: 'grid', gap: 2 }}>
                <label style={{ fontSize: 13, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ minWidth: 150 }}>
                    {r.label}
                    {r.kind === 'percent' ? ' (%)' : ''}
                  </span>
                  {r.kind === 'loan_type' ? (
                    <select value={r.value} onChange={(e) => setRows(editRow(rows, r.key, e.target.value))}>
                      <option value="">Pick one</option>
                      {LOAN_TYPE_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                  ) : r.kind === 'rate_type' ? (
                    <select value={r.value} onChange={(e) => setRows(editRow(rows, r.key, e.target.value))}>
                      <option value="">Pick one</option>
                      <option value="fixed">Fixed</option>
                      <option value="floating">Floating</option>
                    </select>
                  ) : (
                    <input
                      value={shown(r)}
                      inputMode={r.kind === 'text' || r.kind === 'month' ? 'text' : 'decimal'}
                      placeholder={r.kind === 'month' ? 'YYYY-MM' : ''}
                      onChange={(e) => setRows(editRow(rows, r.key, stored(r, e.target.value)))}
                    />
                  )}
                  <span
                    data-testid={`kfs-tag-${r.key}`}
                    className="muted"
                    style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em' }}
                  >
                    {r.value === '' && r.provenance === 'user' ? 'not found, type it in' : provenanceLabel(r.provenance)}
                  </span>
                </label>
                {r.source && r.provenance !== 'user' && (
                  <span className="muted" style={{ fontSize: 11, paddingLeft: 158 }}>
                    {r.provenance === 'kfs' ? '“' + r.source + '”' : r.source}
                  </span>
                )}
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              className="btn-primary"
              data-testid="kfs-add"
              onClick={() => {
                onAdd(loanFromReview(rows, blankLoan(), todayIso));
                reset();
                setOpen(false);
              }}
            >
              Add this loan
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
