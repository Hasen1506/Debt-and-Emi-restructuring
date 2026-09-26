'use client';

/**
 * Shared lender outcomes (ROADMAP Phase 4).
 *
 * - <LenderRecord> shows what other borrowers report about this bank:
 *   figures only from 5 reports, always labelled unverified.
 * - <ShareOutcome> offers to share what the bank did with this
 *   borrower's letter. Only the bank, the outcome, the days taken and the
 *   rate before and after are sent: no name, account, amount or date.
 *   Nothing is sent unless the borrower presses the button.
 */
import { useEffect, useMemo, useState } from 'react';
import Decimal from 'decimal.js';
import { Card } from '@/components/Card';
import { Select } from '@/components/ToolPrimitives';
import {
  api,
  ApiFieldError,
  formatPct,
  type ComplaintReply,
  type LenderScore,
  type OutcomeKind,
  type OutcomeReportRequest,
} from '@/lib/api';
import { parsePercentInput } from '@/lib/rate-input';

const SHARED_KEY = 'rightdue.outcome.shared.v1';
const SHARED_EVENT = 'rightdue:outcome-shared';
const REPLY_DAYS = 30;

const OUTCOME_LABEL: Record<OutcomeKind, string> = {
  fixed_full: 'Fixed in full',
  fixed_part: 'Partly fixed',
  refused: 'Refused',
  no_reply: 'No reply',
};

// ─── the bank's record ─────────────────────────────────────────────────────

export function LenderRecord({ lender }: { lender?: string }) {
  const [s, setS] = useState<LenderScore | null>(null);

  useEffect(() => {
    const name = lender?.trim();
    if (!name) {
      setS(null);
      return;
    }
    let live = true;
    const load = () =>
      api
        .lenderScore(name)
        .then((r) => live && setS(r))
        .catch(() => live && setS(null)); // the record is extra; the check stands without it
    load();
    window.addEventListener(SHARED_EVENT, load);
    return () => {
      live = false;
      window.removeEventListener(SHARED_EVENT, load);
    };
  }, [lender]);

  if (!s || !s.known) return null;
  return (
    <Card>
      <h3 style={{ fontSize: 15, margin: 0 }}>What borrowers report about {s.lender}</h3>
      {s.shown && s.headline ? (
        <>
          <p style={{ fontSize: 16, margin: '8px 0 4px', fontWeight: 600 }}>
            {s.headline.replace(`${s.lender}: `, '')}
          </p>
          <p className="muted" style={{ fontSize: 12, margin: 0 }}>
            From {s.reports} shared reports: {breakdown(s)}.
          </p>
        </>
      ) : (
        <p style={{ fontSize: 14, margin: '8px 0 0' }}>
          {s.reports === 0
            ? `No reports yet. After your letter, you can share what ${s.lender} did.`
            : `${s.reports} borrower${s.reports === 1 ? ' has' : 's have'} shared what ${s.lender} did. ${s.hidden_reason ?? ''}`}
        </p>
      )}
      {s.reports > 0 && (
        <p className="muted" style={{ fontSize: 12, margin: '8px 0 0' }}>
          <strong>Unverified.</strong> {s.label_detail}
        </p>
      )}
    </Card>
  );
}

function breakdown(s: LenderScore): string {
  return (Object.keys(OUTCOME_LABEL) as OutcomeKind[])
    .filter((k) => (s.counts[k] ?? 0) > 0)
    .map((k) => `${OUTCOME_LABEL[k].toLowerCase()} ${s.counts[k]}`)
    .join(', ');
}

// ─── sharing this borrower's outcome ───────────────────────────────────────

export interface TrackedReply {
  sent_on: string;
  received_on: string;
  reply: ComplaintReply;
  reply_on: string;
  new_rate: string;
}

const REPLY_TO_OUTCOME: Record<Exclude<ComplaintReply, 'none'>, OutcomeKind> = {
  fixed: 'fixed_full',
  partly: 'fixed_part',
  rejected: 'refused',
};

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** The report this tracker adds up to, or why there isn't one yet. */
export function draftReport(
  t: TrackedReply,
  currentRate: string,
  today = todayIso(),
): { outcome: OutcomeKind; days: number; rateAfter?: string } | { waiting: string } {
  if (!t.sent_on) return { waiting: 'Once the letter is sent and the bank answers, you can share what it did.' };
  const start = t.received_on || t.sent_on;
  if (t.reply === 'none') {
    const waited = daysBetween(start, today);
    if (waited < REPLY_DAYS) {
      return {
        waiting: `The bank has ${REPLY_DAYS} days to answer. If it hasn't answered by then, you can report that too.`,
      };
    }
    return { outcome: 'no_reply', days: waited };
  }
  if (!t.reply_on) return { waiting: "Add the date of the bank's reply to share what it did." };
  const outcome = REPLY_TO_OUTCOME[t.reply];
  const days = daysBetween(start, t.reply_on);
  if (outcome === 'refused') return { outcome, days };
  const parsed = parsePercentInput(t.new_rate);
  if (!parsed.fraction) {
    return { waiting: 'Add your new rate in the tracker to share what the bank did.' };
  }
  if (!new Decimal(parsed.fraction).lt(currentRate)) {
    return {
      waiting:
        'Your new rate is not lower than the rate you were paying. If the bank did not lower it, set the reply to Rejected.',
    };
  }
  return { outcome, days, rateAfter: parsed.fraction };
}

function sharedKey(lender: string, t: TrackedReply): string {
  return [lender.trim().toLowerCase(), t.sent_on, t.reply].join('|');
}

function loadShared(): Record<string, string> {
  try {
    return JSON.parse(window.localStorage.getItem(SHARED_KEY) ?? '{}');
  } catch {
    return {};
  }
}

function saveShared(key: string, message: string) {
  try {
    window.localStorage.setItem(SHARED_KEY, JSON.stringify({ ...loadShared(), [key]: message }));
  } catch {
    /* private mode: the button may be offered again; the server's limit still holds */
  }
}

export function ShareOutcome({
  lender,
  currentRate,
  track,
}: {
  lender?: string;
  currentRate: string;
  track: TrackedReply;
}) {
  const draft = useMemo(() => draftReport(track, currentRate), [track, currentRate]);
  const [known, setKnown] = useState<LenderScore | null>(null);
  const [choices, setChoices] = useState<{ value: string; label: string }[]>([]);
  const [picked, setPicked] = useState('');
  const [done, setDone] = useState<string | null>(null);
  const [err, setErr] = useState<{ field: string; message: string } | null>(null);
  const [busy, setBusy] = useState(false);

  // Is the bank on the list? If not, the borrower picks it.
  useEffect(() => {
    let live = true;
    const name = lender?.trim() ?? '';
    const lookup = name ? api.lenderScore(name) : Promise.resolve(null);
    lookup
      .then((s) => {
        if (!live) return;
        setKnown(s);
        if (!s?.known) {
          api
            .outcomeLenders()
            .then((xs) => {
              if (!live) return;
              const banks = xs.map((x) => ({ value: x.name, label: x.name }));
              setChoices([{ value: '', label: 'Choose your bank' }, ...banks]);
            })
            .catch(() => undefined);
        }
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [lender]);

  const bank = known?.known ? (known.lender ?? '') : picked;

  useEffect(() => {
    setDone(bank ? (loadShared()[sharedKey(bank, track)] ?? null) : null);
    setErr(null);
  }, [bank, track]);

  if ('waiting' in draft) {
    return (
      <Card>
        <h2 style={{ fontSize: 20, margin: 0 }}>Help the next borrower</h2>
        <p className="muted" style={{ fontSize: 14, margin: '6px 0 0' }}>
          {draft.waiting}
        </p>
      </Card>
    );
  }

  const report: OutcomeReportRequest = {
    lender: bank,
    outcome: draft.outcome,
    days_taken: draft.days,
    rate_before: currentRate,
    ...(draft.rateAfter ? { rate_after: draft.rateAfter } : {}),
  };

  async function share() {
    if (!bank) {
      setErr({ field: 'lender', message: 'Choose your bank from the list.' });
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const r = await api.shareOutcome(report);
      saveShared(sharedKey(bank, track), r.message);
      setDone(r.message);
      window.dispatchEvent(new Event(SHARED_EVENT));
    } catch (e) {
      setErr(
        e instanceof ApiFieldError
          ? { field: e.field, message: e.message }
          : { field: '', message: (e as Error).message },
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <h2 style={{ fontSize: 20, margin: 0 }}>Help the next borrower</h2>
      <p style={{ fontSize: 14, margin: '6px 0 12px' }}>
        Share what the bank did, anonymously. Once 5 borrowers have shared a report about a
        bank, Loan Check shows others how often it fixes the rate and how long it takes.
      </p>
      {!known?.known && (
        <div style={{ maxWidth: 320, marginBottom: 12 }}>
          <Select
            label="Your bank"
            value={picked}
            onChange={setPicked}
            options={choices.length ? choices : [{ value: '', label: 'Loading banks…' }]}
            error={err?.field === 'lender' ? err.message : null}
          />
        </div>
      )}
      <p style={{ fontSize: 13, margin: '0 0 4px', fontWeight: 600 }}>Only this is sent:</p>
      <ul style={{ fontSize: 14, margin: '0 0 8px', paddingLeft: 18 }}>
        <li>Bank: {bank || '(choose above)'}</li>
        <li>What it did: {OUTCOME_LABEL[draft.outcome]}</li>
        <li>
          {draft.outcome === 'no_reply' ? 'Days waited' : 'Days it took'}: {draft.days}
        </li>
        <li>
          Rate: {formatPct(currentRate, 2)}
          {draft.rateAfter ? ` → ${formatPct(draft.rateAfter, 2)}` : ' (unchanged)'}
        </li>
      </ul>
      <p className="muted" style={{ fontSize: 12, margin: '0 0 12px' }}>
        Not your name, account number, amounts or dates. Reports are not checked, so the
        figures are shown as unverified.
      </p>
      {done ? (
        <p role="status" style={{ fontSize: 14, margin: 0, color: 'var(--positive)' }}>
          Shared. {done}
        </p>
      ) : (
        <div>
          <button type="button" className="btn btn-primary" onClick={share} disabled={busy}>
            {busy ? 'Sharing…' : 'Share anonymously'}
          </button>
          {err && err.field !== 'lender' && (
            <p role="alert" style={{ margin: '8px 0 0', color: 'var(--negative)', fontSize: 13 }}>
              {err.message}
            </p>
          )}
        </div>
      )}
    </Card>
  );
}
