'use client';

/**
 * Complaint panel under a Loan Check result: the letter, the deadlines
 * once it is sent, and the escalation (Internal Ombudsman, RBI Ombudsman).
 *
 * The borrower's name, account number and contact details are filled into
 * the letter here, in the browser; the API only ever sees loan facts.
 * Where the complaint has got to (dates, reply) is remembered in this
 * browser so the tracker picks up on the next visit.
 */
import { useEffect, useState } from 'react';
import { LSectionHeader } from '@/components/ledger/primitives';
import { Card } from '@/components/Card';
import { Field, Select } from '@/components/ToolPrimitives';
import {
  api,
  ApiFieldError,
  formatCurrency,
  type ComplaintMilestone,
  type ComplaintReply,
  type ComplaintResponse,
  type LoanCheckCitation,
  type LoanCheckRequest,
} from '@/lib/api';
import { EMPTY_BORROWER, fillLetter, missingDetails, type Borrower } from '@/lib/complaint-fill';
import { parsePercentInput } from '@/lib/rate-input';
import { formatIso } from '@/lib/today';
import { ShareOutcome } from './outcome';
// G7: follow-up reminders (calendar file; email when the server has them on).
import { DeadlineReminders } from '@/components/home/DeadlineReminders';
import { getCountryToday, localIsoDate } from '@/lib/today';

const TRACK_KEY = 'rightdue.complaint.in.v1';

interface Track {
  sent_on: string;
  received_on: string;
  reply: ComplaintReply;
  reply_on: string;
  io_reviewed: boolean;
  bank_reference: string;
  /** The rate after the bank's fix, as typed (percent). */
  new_rate: string;
}

const EMPTY_TRACK: Track = {
  sent_on: '',
  received_on: '',
  reply: 'none',
  reply_on: '',
  io_reviewed: false,
  bank_reference: '',
  new_rate: '',
};

function loadTrack(): Track {
  try {
    const raw = window.localStorage.getItem(TRACK_KEY);
    return raw ? { ...EMPTY_TRACK, ...JSON.parse(raw) } : EMPTY_TRACK;
  } catch {
    return EMPTY_TRACK;
  }
}

function saveTrack(t: Track) {
  try {
    window.localStorage.setItem(TRACK_KEY, JSON.stringify(t));
  } catch {
    /* private mode: the tracker just won't be remembered */
  }
}

const REPLY_OPTIONS: { value: ComplaintReply; label: string }[] = [
  { value: 'none', label: 'No reply yet' },
  { value: 'fixed', label: 'Fixed in full' },
  { value: 'partly', label: 'Partly accepted' },
  { value: 'rejected', label: 'Rejected' },
];

const STATE_LABEL: Record<ComplaintMilestone['state'], string> = {
  done: 'Done',
  due: 'Due',
  overdue: 'Overdue',
  upcoming: 'Coming up',
  missed: 'Missed',
};

function stateColor(s: ComplaintMilestone['state']): string {
  if (s === 'done') return 'var(--positive)';
  if (s === 'overdue' || s === 'missed') return 'var(--negative)';
  if (s === 'due') return 'var(--accent)';
  return 'var(--muted, #777)';
}

function longDate(iso: string): string {
  return formatIso(iso, 'long');
}

export function ComplaintPanel({ request }: { request: LoanCheckRequest }) {
  const [who, setWho] = useState<Borrower>(EMPTY_BORROWER);
  const [track, setTrack] = useState<Track>(EMPTY_TRACK);
  // The tracker as last applied (what the deadlines and sharing use).
  const [applied, setApplied] = useState<Track | null>(null);
  const [res, setRes] = useState<ComplaintResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Critique #54: copy / download unlock only once every check is ticked.
  const [ticked, setTicked] = useState<boolean[]>([]);

  async function load(t: Track) {
    setBusy(true);
    setErr(null);
    try {
      const sent = !!t.sent_on;
      const r = await api.complaintIn({
        ...request,
        sent_on: t.sent_on || undefined,
        received_on: sent && t.received_on ? t.received_on : undefined,
        reply: sent ? t.reply : undefined,
        reply_on: sent && t.reply !== 'none' && t.reply_on ? t.reply_on : undefined,
        io_reviewed: sent && t.reply !== 'none' ? t.io_reviewed : undefined,
        bank_reference: t.bank_reference.trim() || undefined,
      });
      setRes(r);
      setApplied(t);
    } catch (e) {
      setErr(e instanceof ApiFieldError ? e.message : (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // A new check result (or the first visit) loads the letter, and the
  // tracker if this browser has a sent date saved.
  useEffect(() => {
    const t = loadTrack();
    setTrack(t);
    load(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request]);

  function updateTracker(e: React.FormEvent) {
    e.preventDefault();
    if (track.reply !== 'none' && !track.reply_on) {
      setErr("Still needed: the date of the bank's reply.");
      return;
    }
    if (fixedReply && track.new_rate && newRate.error) {
      setErr(`New rate: ${newRate.error}`);
      return;
    }
    saveTrack(track);
    load(track);
  }

  const set = <K extends keyof Track>(k: K) => (v: Track[K]) => setTrack((t) => ({ ...t, [k]: v }));
  const fixedReply = track.reply === 'fixed' || track.reply === 'partly';
  const newRate = parsePercentInput(track.new_rate);
  const setWhoField = (k: keyof Borrower) => (v: string) => setWho((w) => ({ ...w, [k]: v }));

  if (!res) {
    return err ? (
      <Card>
        <p role="alert" style={{ margin: 0, color: 'var(--negative)' }}>
          {err}
        </p>
      </Card>
    ) : null;
  }

  const ph = res.placeholders;
  const checks = res.self_check ?? [];
  const allTicked = checks.length === 0 || checks.every((_, i) => ticked[i]);
  const missing = missingDetails(who, res.letter.text, ph);
  const fill = (text: string) => fillLetter(text, ph, who);
  const t = res.timeline;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Card>
        <LSectionHeader>Write the complaint</LSectionHeader>
        {res.draft_notice && (
          <p
            role="note"
            data-testid="lc-draft-notice"
            style={{
              margin: '8px 0 0',
              padding: '8px 12px',
              border: '1px dashed var(--accent)',
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            {res.draft_notice}
          </p>
        )}
        <p style={{ margin: '6px 0 14px', fontSize: 14 }}>
          The letter asks the bank to reset your rate and refund{' '}
          {formatCurrency(res.letter.claim_amount, 'INR')}, the missed rate cut only.
          Paying more than new borrowers isn&apos;t something a bank has to refund, so
          it&apos;s left out: including it would weaken the complaint.
        </p>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: 12,
          }}
        >
          <Field label="Your full name" kind="text" value={who.name} onChange={setWhoField('name')} />
          <Field
            label="Loan account number"
            kind="text"
            value={who.account}
            onChange={setWhoField('account')}
          />
          <Field label="Phone (optional)" kind="text" value={who.phone} onChange={setWhoField('phone')} />
          <Field label="Email (optional)" kind="text" value={who.email} onChange={setWhoField('email')} />
          <Field
            label="Postal address (optional)"
            kind="text"
            value={who.address}
            onChange={setWhoField('address')}
          />
        </div>
        <p className="muted" style={{ fontSize: 12, margin: '8px 0 0' }}>
          These details stay in this browser. They are filled into the letter here and
          never sent to RightDue&apos;s server.
        </p>
        {missing.length > 0 && (
          <p role="status" style={{ fontSize: 12, margin: '4px 0 0', color: 'var(--accent)' }}>
            Still needed in the letter: {missing.join(' and ')}.
          </p>
        )}

        {checks.length > 0 && (
          <fieldset
            data-testid="lc-self-check"
            style={{ border: '1px solid var(--border)', padding: '10px 14px', margin: '14px 0 0' }}
          >
            <legend style={{ fontSize: 12, letterSpacing: '0.12em', textTransform: 'uppercase' }}>
              Before you send: check each one
            </legend>
            {checks.map((c, i) => (
              <label key={c} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 13, margin: '4px 0' }}>
                <input
                  type="checkbox"
                  checked={!!ticked[i]}
                  onChange={(e) =>
                    setTicked((t) => {
                      const next = [...t];
                      next[i] = e.target.checked;
                      return next;
                    })
                  }
                />
                <span>{c}</span>
              </label>
            ))}
            {!allTicked && (
              <p className="muted" style={{ fontSize: 12, margin: '6px 0 0' }}>
                Copy and download unlock once every box is ticked.
              </p>
            )}
          </fieldset>
        )}
        <LetterBox
          label="Complaint letter (draft)"
          text={fill(res.letter.text)}
          filename="complaint-letter-draft.txt"
          locked={!allTicked}
        />
        <p style={{ fontSize: 13, margin: '10px 0 0' }}>
          Send it through the bank&apos;s online grievance form or its grievance email,
          and keep the acknowledgement with the complaint number. By post, keep proof of
          delivery. Attach the enclosures listed at the end.
        </p>
        <Citations items={res.letter.citations} />
      </Card>

      <Card>
        <LSectionHeader>Track it</LSectionHeader>
        <p className="muted" style={{ fontSize: 13, margin: '6px 0 12px' }}>
          Once it&apos;s sent, add the dates. The deadlines are counted from when the
          bank got it, and the next step appears here.
        </p>
        <form
          onSubmit={updateTracker}
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: 12,
          }}
        >
          <Field label="Date sent" kind="date" value={track.sent_on} onChange={set('sent_on')} />
          <Field
            label="Delivery date (if posted)"
            kind="date"
            value={track.received_on}
            onChange={set('received_on')}
          />
          <Field
            label="Bank's complaint reference (optional)"
            kind="text"
            value={track.bank_reference}
            onChange={set('bank_reference')}
          />
          <Select label="Bank's reply" value={track.reply} onChange={set('reply')} options={REPLY_OPTIONS} />
          {track.reply !== 'none' && (
            <Field label="Date of the reply" kind="date" value={track.reply_on} onChange={set('reply_on')} />
          )}
          {fixedReply && (
            <Field
              label="Your new rate (%)"
              value={track.new_rate}
              onChange={set('new_rate')}
              hint="From the bank's reply or your next statement."
              error={track.new_rate ? newRate.error : null}
            />
          )}
          {(track.reply === 'partly' || track.reply === 'rejected') && (
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
              <input
                type="checkbox"
                checked={track.io_reviewed}
                onChange={(e) => set('io_reviewed')(e.target.checked)}
              />
              The reply says the bank&apos;s Internal Ombudsman reviewed it
            </label>
          )}
          <div style={{ gridColumn: '1 / -1' }}>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? 'Updating…' : 'Update deadlines'}
            </button>
            {err && (
              <span role="alert" style={{ marginLeft: 12, color: 'var(--negative)', fontSize: 13 }}>
                {err}
              </span>
            )}
          </div>
        </form>

        {t && (
          <div aria-live="polite" style={{ marginTop: 16 }}>
            <p style={{ fontSize: 15, margin: '0 0 10px', fontWeight: 600 }}>{t.next_action}</p>
            <ol style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 6 }}>
              {t.milestones.map((m) => (
                <li
                  key={m.key}
                  style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px', fontSize: 14 }}
                >
                  <span style={{ minWidth: 150 }}>{longDate(m.day)}</span>
                  <span style={{ flex: '1 1 200px' }}>
                    {m.label}
                    {m.note && (
                      <span className="muted" style={{ display: 'block', fontSize: 12 }}>
                        {m.note}
                      </span>
                    )}
                  </span>
                  <span style={{ color: stateColor(m.state), fontWeight: 600 }}>
                    {STATE_LABEL[m.state]}
                  </span>
                </li>
              ))}
            </ol>
            {t.notes.map((n) => (
              <p key={n} className="muted" style={{ fontSize: 12, margin: '8px 0 0' }}>
                {n}
              </p>
            ))}
            <DeadlineReminders
              items={t.milestones}
              source="complaint"
              todayIso={localIsoDate(getCountryToday('IN'))}
              title={`Complaint to ${request.lender || 'the lender'}`}
            />
          </div>
        )}
      </Card>

      {applied && (
        <ShareOutcome lender={request.lender} currentRate={request.current_rate} track={applied} />
      )}

      {res.io_followup && (
        <Card>
          <LSectionHeader>Ask for the Internal Ombudsman&apos;s review</LSectionHeader>
          <p style={{ margin: '6px 0 0', fontSize: 14 }}>
            A bank that rejects a complaint, or resolves it only in part, must pass it
            automatically to its Internal Ombudsman before giving a final answer. Send this follow-up the same way as
            the complaint.
          </p>
          <LetterBox
            label="Internal Ombudsman follow-up (draft)"
            text={fill(res.io_followup.text)}
            filename="internal-ombudsman-followup-draft.txt"
            locked={!allTicked}
          />
        </Card>
      )}

      {res.ombudsman && t && (
        <Card>
          <LSectionHeader>RBI Ombudsman complaint</LSectionHeader>
          <p style={{ margin: '6px 0 0', fontSize: 14 }}>
            {res.ombudsman.opens && res.ombudsman.deadline && (
              <>
                {t.stage === 'ombudsman_open' ? 'Open now' : `Opens ${longDate(res.ombudsman.opens)}`}.
                {' '}Last day to file: <strong>{longDate(res.ombudsman.deadline)}</strong>. Free.
                The 2026 scheme allows 90 days, not a year.
              </>
            )}
          </p>
          <ul style={{ fontSize: 14, margin: '10px 0', paddingLeft: 18 }}>
            {res.ombudsman.how_to_file.map((h) => (
              <li key={h}>{h}</li>
            ))}
          </ul>
          <div role="region" aria-label="Complaint form answers" tabIndex={0} style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', fontSize: 14, width: '100%' }}>
              <tbody>
                {res.ombudsman.fields.map((f) => (
                  <tr key={f.label} style={{ borderTop: '1px solid var(--border)' }}>
                    <th scope="row" style={{ textAlign: 'left', padding: '6px 12px 6px 0', fontWeight: 500 }}>
                      {f.label}
                    </th>
                    <td style={{ padding: '6px 0' }}>
                      {fill(f.value)}
                      {f.hint && (
                        <span className="muted" style={{ display: 'block', fontSize: 12 }}>
                          {f.hint}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <LetterBox label="Facts of the complaint" text={fill(res.ombudsman.facts)} />
          <LetterBox label="Relief sought" text={res.ombudsman.relief} />
          <h3 style={{ fontSize: 12, margin: '14px 0 4px', letterSpacing: '0.12em', textTransform: 'uppercase' }}>Upload</h3>
          <ul style={{ fontSize: 14, margin: 0, paddingLeft: 18 }}>
            {res.ombudsman.documents.map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ul>
          <h3 style={{ fontSize: 12, margin: '14px 0 4px', letterSpacing: '0.12em', textTransform: 'uppercase' }}>Confirm on the portal, only if true</h3>
          <ul style={{ fontSize: 14, margin: 0, paddingLeft: 18 }}>
            {res.ombudsman.declarations.map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ul>
          <Citations items={res.ombudsman.citations} />
        </Card>
      )}
    </div>
  );
}

function LetterBox({
  label,
  text,
  filename,
  locked = false,
}: {
  label: string;
  text: string;
  filename?: string;
  locked?: boolean;
}) {
  const [copied, setCopied] = useState<string | null>(null);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied('Copied.');
    } catch {
      setCopied('Copy did not work here. Select the text and copy it.');
    }
  }

  function download() {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename ?? 'letter.txt';
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 6 }}>
        <h3 style={{ fontSize: 12, margin: 0, flex: '1 1 auto', letterSpacing: '0.12em', textTransform: 'uppercase' }}>{label}</h3>
        <button type="button" className="btn" onClick={copy} disabled={locked}>
          Copy
        </button>
        {filename && (
          <button type="button" className="btn" onClick={download} disabled={locked}>
            Download .txt
          </button>
        )}
        <span role="status" className="muted" style={{ fontSize: 12 }}>
          {copied}
        </span>
      </div>
      <div
        role="region"
        aria-label={label}
        tabIndex={0}
        style={{
          whiteSpace: 'pre-wrap',
          overflowWrap: 'anywhere',
          fontSize: 14,
          lineHeight: 1.5,
          padding: 14,
          border: '1px solid var(--border)',
          borderRadius: 6,
          background: 'var(--canvas)',
          maxHeight: 420,
          overflowY: 'auto',
        }}
      >
        {text}
      </div>
    </div>
  );
}

export function Citations({ items }: { items: LoanCheckCitation[] }) {
  if (!items.length) return null;
  const unverified = items.some((c) => !c.verified_against_text);
  return (
    <details style={{ marginTop: 12, fontSize: 13 }}>
      <summary style={{ cursor: 'pointer' }}>Rules this relies on</summary>
      {unverified && (
        <p className="muted" style={{ fontSize: 12, margin: '6px 0' }}>
          These are plain-language summaries, not quotations. Check the source before
          relying on the exact wording.
        </p>
      )}
      <ul style={{ paddingLeft: 18, margin: '6px 0 0' }}>
        {items.map((c, i) => (
          <li key={i} style={{ marginBottom: 10 }}>
            <strong>{c.rule}.</strong> {c.requirement}
            <RuleQuote c={c} />
          </li>
        ))}
      </ul>
    </details>
  );
}

/** The rule's own words, its paragraph and a link, when it was checked
 *  against the text (critique #40); otherwise the source line. */
export function RuleQuote({ c }: { c: LoanCheckCitation }) {
  if (!c.verified_against_text || !c.clause) {
    return <span className="muted"> Source: {c.source}.</span>;
  }
  const checked = c.checked_on
    ? formatIso(c.checked_on)
    : '';
  return (
    <>
      <blockquote
        style={{ margin: '6px 0 0', padding: '4px 10px', borderLeft: '3px solid var(--border)', fontSize: 12 }}
      >
        &ldquo;{c.clause}&rdquo;
      </blockquote>
      <span className="muted" style={{ display: 'block', fontSize: 11, marginTop: 2 }}>
        {c.paragraph ? `${c.paragraph}. ` : ''}
        {c.url && (
          <a href={c.url} target="_blank" rel="noopener noreferrer">
            Read it on the regulator&apos;s site
          </a>
        )}
        {checked && ` · wording checked ${checked}`}
      </span>
    </>
  );
}
