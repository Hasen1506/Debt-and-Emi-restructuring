'use client';

/**
 * Decision-log controls — a small in-card affordance that lets the
 * user mark a recommendation as accepted / declined / reconciled.
 *
 * Embedded inside verdict cards on /tools/liquidate, /tools/purchase,
 * /goals (and anywhere else the app surfaces a recommendation with an
 * estimated amount). Persists to localStorage via @/lib/decision-log;
 * the recommender can later read the log to calibrate estimates
 * against actuals.
 *
 * Three states cycle through:
 *
 *   1. Idle — "Track this recommendation" button (single tap).
 *   2. Recorded — accepted / declined / reconcile-now buttons.
 *   3. Reconciled — shows the saved actual + delta vs estimate.
 *
 * Stateless across tool reloads via the `existingDecisionId` prop —
 * callers can pass an id loaded from `readDecisionsClient()` to
 * resume the workflow on a previously-recorded recommendation.
 */

import { useEffect, useState } from 'react';
import {
  findActiveEntry,
  logRecommendation,
  decideRecommendation,
  deleteDecision,
  pruneStaleRecommendations,
  reconcileDecision,
  readDecisionsClient,
  summarizeCalibration,
  updateRecommendation,
  writeDecisionsClient,
  type DecisionEntry,
  type DecisionKind,
} from '@/lib/decision-log';
import { undoExpenseCommit } from '@/lib/expense-commit';
import { localIsoDate } from '@/lib/today';

interface Props {
  kind: DecisionKind;
  /** Free-text describing what the app is recommending. Stored on
   *  the entry so the user remembers *why* it was suggested when they
   *  reconcile weeks later. */
  context: string;
  /** Estimated cash impact in user residence ccy, decimal string. */
  estimatedAmount: string;
  /** Optional reasoning narrative (verdict + rationale). */
  reasoning?: string;
  /** Tool slug / surface — groups entries for calibration stats. */
  source?: string;
  /** Currency symbol for the actual-amount input ('₹' / '$'). */
  ccySym: string;
}

export function DecisionLogControls({
  kind,
  context,
  estimatedAmount,
  reasoning,
  source,
  ccySym,
}: Props) {
  const [entry, setEntry] = useState<DecisionEntry | null>(null);
  const [actualAmount, setActualAmount] = useState('');
  const [actualDate, setActualDate] = useState(() =>
    localIsoDate(new Date()),
  );
  const [notes, setNotes] = useState('');
  // Calibration stats over previously reconciled entries of this kind
  // — surfaces "your estimates run ±X% over N samples" so the user has
  // an honest read on how accurate the recommender's been for them
  // historically. Recomputed when `entry` flips so a fresh reconcile
  // immediately updates the badge.
  const [calibration, setCalibration] = useState<ReturnType<
    typeof summarizeCalibration
  > | null>(null);
  // Notice surfaced when mount-time pruning deletes stale rows. Without
  // this, the user has no idea the cleanup happened — silent data loss.
  // Dismissed by the user; not reset across mounts of the same tool.
  const [prunedCount, setPrunedCount] = useState(0);

  // Resume an in-progress entry on mount: pick up the most-recent
  // unreconciled entry for this (kind, source) pair via findActiveEntry.
  // Matching on (kind, source) only — not on estimatedAmount/context —
  // means tweaking tool inputs while the workflow is in flight updates
  // the existing entry rather than spawning a fresh orphan. Calibration
  // narrows to (kind, source) too so cross-tool noise stays out of the
  // historical badge.
  //
  // Side-effect on mount: prune orphan `recommended` rows older than
  // 30 days. Surface the count via the dismissible notice below so the
  // user can see what was cleaned up.
  useEffect(() => {
    const raw = readDecisionsClient();
    const pruned = pruneStaleRecommendations(raw);
    const diff = raw.length - pruned.length;
    if (diff > 0) {
      writeDecisionsClient(pruned);
      setPrunedCount((c) => c + diff);
    }
    const match = findActiveEntry(pruned, kind, source);
    if (match) setEntry(match);
    setCalibration(summarizeCalibration(pruned, kind, source));
  }, [kind, source]);

  // Keep the active entry in sync with current inputs: if the user is
  // tweaking the tool with a still-recommended entry tracked, write the
  // new estimatedAmount / context / reasoning to the existing row
  // rather than letting it drift away from what the UI is showing. No-op
  // when there's no entry or it's already past 'recommended'.
  useEffect(() => {
    if (!entry || entry.status !== 'recommended') return;
    const same =
      entry.recommendation.context === context &&
      entry.recommendation.estimatedAmount === estimatedAmount &&
      (entry.recommendation.reasoning ?? '') === (reasoning ?? '');
    if (same) return;
    const next = updateRecommendation(readDecisionsClient(), entry.id, {
      context,
      estimatedAmount,
      reasoning,
      source,
    });
    writeDecisionsClient(next);
    const updated = next.find((e) => e.id === entry.id);
    if (updated) setEntry(updated);
  }, [context, estimatedAmount, reasoning, source, entry]);

  function record() {
    // If an unreconciled entry already exists for this (kind, source),
    // update it in place rather than spawning a parallel orphan. This
    // matches the resume-on-mount semantics above.
    const current = readDecisionsClient();
    const existing = findActiveEntry(current, kind, source);
    let next: DecisionEntry[];
    if (existing) {
      next = updateRecommendation(current, existing.id, {
        context,
        estimatedAmount,
        reasoning,
        source,
      });
    } else {
      next = logRecommendation(current, kind, {
        context,
        estimatedAmount,
        reasoning,
        source,
      });
    }
    writeDecisionsClient(next);
    const updated = findActiveEntry(next, kind, source);
    setEntry(updated);
    setCalibration(summarizeCalibration(next, kind, source));
  }

  function decide(d: 'accepted' | 'declined') {
    if (!entry) return;
    const next = decideRecommendation(readDecisionsClient(), entry.id, d);
    writeDecisionsClient(next);
    const updated = next.find((e) => e.id === entry.id);
    if (updated) setEntry(updated);
  }

  function reconcile() {
    if (!entry) return;
    const n = parseAmount(actualAmount);
    if (n <= 0) return;
    const next = reconcileDecision(readDecisionsClient(), entry.id, {
      // Persist the cleaned numeric string so calibration math (which
      // does `Number(actualAmount)` later) doesn't trip on commas again.
      actualAmount: String(n),
      actualDate,
      notes: notes || undefined,
    });
    writeDecisionsClient(next);
    const updated = next.find((e) => e.id === entry.id);
    if (updated) setEntry(updated);
    setCalibration(summarizeCalibration(next, kind, source));
  }

  function discard() {
    if (!entry) return;
    // expense_commit entries carry a profile mutation. Discarding the
    // entry without restoring expenses would leave the cut "permanent"
    // even though the user is revoking it — confirm + restore first.
    if (entry.kind === 'expense_commit') {
      const ok = window.confirm(
        "Undo this expense cut? Your monthly expenses will be restored to the pre-commit value and the entry removed.",
      );
      if (!ok) return;
      // Restore BEFORE deleting the entry so a save failure (cookie
      // quota, etc.) leaves the audit trail intact rather than losing
      // both the mutation snapshot AND the entry.
      undoExpenseCommit(entry);
    } else {
      // Confirm for every other kind — including 'recommended'. The
      // bare × button was a one-tap data loser before: a user
      // exploring the tool, clicked "Track this", then hit × to
      // dismiss the panel, lost the entry without warning. Now every
      // discard goes through confirm; the message varies by status so
      // calibration-bearing entries get a stronger warning.
      const msg =
        entry.status === 'recommended'
          ? 'Discard this tracked recommendation?'
          : 'Delete this tracked recommendation? Calibration history will lose this entry.';
      const ok = window.confirm(msg);
      if (!ok) return;
    }
    const next = deleteDecision(readDecisionsClient(), entry.id);
    writeDecisionsClient(next);
    setEntry(null);
    setCalibration(summarizeCalibration(next, kind, source));
  }

  if (!entry) {
    return (
      <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <CalibrationBadge calibration={calibration} />
        <PrunedNotice count={prunedCount} onDismiss={() => setPrunedCount(0)} />
        <div
          style={{
            padding: '10px 12px',
            background: 'var(--soft-bg)',
            border: '1px dashed var(--border)',
            borderRadius: 0,
            fontSize: 'var(--fs-dense)',
            color: 'var(--muted)',
            lineHeight: 1.5,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 10,
          }}
        >
          <span>Track this to compare the estimate with what really happens.</span>
          <button
            type="button"
            onClick={record}
            style={{ ...btnStyle('var(--ink)'), flexShrink: 0 }}
          >
            [+ Track this]
          </button>
        </div>
      </div>
    );
  }

  if (entry.status === 'reconciled' && entry.outcome) {
    const est = Number(entry.recommendation.estimatedAmount);
    const act = Number(entry.outcome.actualAmount);
    const delta = act - est;
    const deltaPct = est > 0 ? (delta / est) * 100 : 0;
    const tone = delta >= 0 ? 'var(--positive)' : 'var(--negative)';
    const locale = ccySym === '₹' ? 'en-IN' : 'en-US';
    return (
      <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <CalibrationBadge calibration={calibration} />
        <PrunedNotice count={prunedCount} onDismiss={() => setPrunedCount(0)} />
        <div
          style={{
            padding: 12,
            border: '1px solid var(--border)',
            borderRadius: 0,
            fontSize: 'var(--fs-dense)',
            lineHeight: 1.6,
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'baseline',
              marginBottom: 4,
            }}
          >
            <div style={{ fontWeight: 600 }}>
              Done · {new Date(`${entry.outcome.actualDate}T00:00:00`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
            </div>
            <button
              type="button"
              onClick={discard}
              title="Delete this entry"
              className="l-hit" style={discardBtnStyle}
            >
              ×
            </button>
          </div>
          <div className="muted">
            Estimated {ccySym}
            {est.toLocaleString(locale)} · actual {ccySym}
            {act.toLocaleString(locale)} ·{' '}
            <span style={{ color: tone, fontWeight: 600 }}>
              {delta >= 0 ? '+' : '−'}
              {ccySym}
              {Math.abs(Math.round(delta)).toLocaleString(locale)} ({deltaPct >= 0 ? '+' : '−'}
              {Math.abs(deltaPct).toFixed(1)}%)
            </span>
          </div>
          {entry.outcome.notes && (
            <div className="muted" style={{ marginTop: 4 }}>
              {entry.outcome.notes}
            </div>
          )}
        </div>
      </div>
    );
  }

  // Recorded or accepted/declined — show next-step controls.
  return (
    <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <CalibrationBadge calibration={calibration} />
      <PrunedNotice count={prunedCount} onDismiss={() => setPrunedCount(0)} />
      <div
        style={{
          padding: 12,
          border: '1px solid var(--border)',
          borderRadius: 0,
          fontSize: 'var(--fs-dense)',
          lineHeight: 1.55,
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'baseline',
            gap: 8,
          }}
        >
          <div>
            <strong>Tracked{entry.status === 'accepted' ? ': you did it' : entry.status === 'declined' ? ': you didn’t' : ''}.</strong>{' '}
            <span className="muted">
              {entry.status === 'recommended' ? 'Say whether you did it. ' : ''}Enter the real amount once the money moves.
            </span>
          </div>
          <button
            type="button"
            onClick={discard}
            title="Discard this tracked recommendation"
            className="l-hit" style={discardBtnStyle}
          >
            ×
          </button>
        </div>
      {entry.status === 'recommended' && (
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            onClick={() => decide('accepted')}
            style={btnStyle('var(--positive)')}
          >
            [✓ Did it]
          </button>
          <button
            type="button"
            onClick={() => decide('declined')}
            style={btnStyle('var(--negative)')}
          >
            [✗ Didn’t]
          </button>
        </div>
      )}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 150px), 1fr))',
          gap: 8,
          alignItems: 'end',
        }}
      >
        <label style={lblStyle}>
          <span>It came to ({ccySym})</span>
          <input
            type="text"
            inputMode="decimal"
            value={actualAmount}
            onChange={(e) => setActualAmount(e.target.value)}
            style={inputStyle}
          />
        </label>
        <label style={lblStyle}>
          <span>On</span>
          <input
            type="date"
            value={actualDate}
            onChange={(e) => setActualDate(e.target.value)}
            style={inputStyle}
          />
        </label>
        <label style={lblStyle}>
          <span>Notes (optional)</span>
          <input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Why it differed"
            style={inputStyle}
          />
        </label>
        <button
          type="button"
          onClick={reconcile}
          disabled={parseAmount(actualAmount) <= 0}
          style={{
            ...btnStyle('var(--ink)'),
            background: 'var(--ink)',
            color: 'var(--canvas)',
            opacity: parseAmount(actualAmount) > 0 ? 1 : 0.5,
            height: 30,
          }}
        >
          [ Save ]
        </button>
      </div>
      </div>
    </div>
  );
}

/**
 * Small badge that surfaces the user's historical calibration for a
 * given decision kind — "estimates run ±X% over N samples". Hidden
 * until at least 2 reconciled entries exist, so a single bad
 * reconcile doesn't dominate the read.
 *
 * Tone:
 *   • muted when |mean abs delta| < 5% — the estimator's honest.
 *   • warning when between 5-15% — worth knowing.
 *   • negative when > 15% — flag for the user.
 */
function CalibrationBadge({
  calibration,
}: {
  calibration: ReturnType<typeof summarizeCalibration> | null;
}) {
  if (!calibration || calibration.sampleSize < 2) return null;
  const absPct = Math.abs(calibration.meanAbsPctDelta) * 100;
  const signedPct = calibration.meanSignedPctDelta * 100;
  const tone =
    absPct < 5
      ? 'var(--muted)'
      : absPct < 15
        ? 'var(--warning)'
        : 'var(--negative)';
  const directionWord =
    signedPct > 1
      ? 'came in higher'
      : signedPct < -1
        ? 'came in lower'
        : 'was close';
  return (
    <div
      style={{
        padding: '6px 10px',
        background: 'var(--card)',
        border: `1px solid ${tone}`,
        borderRadius: 0,
        fontSize: 'var(--fs-small)',
        color: tone,
        lineHeight: 1.4,
      }}
    >
      Over {calibration.sampleSize} past entries the estimate was off by{' '}
      <strong>{absPct.toFixed(1)}%</strong> on average; what really happened {directionWord}.
    </div>
  );
}

/** Dismissible "we cleaned up N stale tracked recommendations" notice.
 *  Surfaces what pruneStaleRecommendations did on mount — without this
 *  the cleanup is silent data loss from the user's perspective. */
function PrunedNotice({
  count,
  onDismiss,
}: {
  count: number;
  onDismiss: () => void;
}) {
  if (count <= 0) return null;
  return (
    <div
      style={{
        padding: '6px 10px',
        background: 'var(--soft-bg)',
        borderLeft: '3px solid var(--muted)',
        borderRadius: 0,
        fontSize: 'var(--fs-small)',
        color: 'var(--muted)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 10,
        lineHeight: 1.45,
      }}
    >
      <span>
        Removed <strong>{count}</strong> tracked{' '}
        {count === 1 ? 'entry' : 'entries'} over 30 days old that{' '}
        {count === 1 ? 'was' : 'were'} never marked done.
      </span>
      <button
        type="button"
        onClick={onDismiss}
        title="Dismiss"
        style={{
          flexShrink: 0,
          padding: '0 6px',
          border: '1px solid var(--border)',
          background: 'transparent',
          color: 'var(--muted)',
          borderRadius: 0,
          cursor: 'pointer',
          fontSize: 'var(--fs-dense)',
        }}
      >
        ×
      </button>
    </div>
  );
}

const lblStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  fontSize: 'var(--fs-small)',
  color: 'var(--muted)',
};

const inputStyle: React.CSSProperties = {
  padding: '4px 8px',
  fontSize: 'var(--fs-dense)',
  border: '1px solid var(--border)',
  borderRadius: 0,
  background: 'var(--canvas)',
  color: 'var(--ink)',
};

function btnStyle(color: string): React.CSSProperties {
  return {
    padding: '6px 10px',
    border: `1px solid ${color}`,
    background: 'transparent',
    color,
    borderRadius: 0,
    cursor: 'pointer',
    fontFamily: 'inherit',
    fontSize: 'var(--fs-label)',
    fontWeight: 700,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
  };
}

/** Strip locale thousands separators + currency symbols, return as number.
 *  Used by both the parse-on-submit path and the button-enabled check so
 *  the two stay in lock-step. NaN → 0 so the button never enables on
 *  unparseable input. */
function parseAmount(raw: string): number {
  const cleaned = raw.replace(/[,₹$\s]/g, '');
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

const discardBtnStyle: React.CSSProperties = {
  padding: '0 6px',
  border: '1px solid var(--border)',
  background: 'transparent',
  color: 'var(--muted)',
  borderRadius: 0,
  cursor: 'pointer',
  fontSize: 'var(--fs-body)',
  lineHeight: 1.4,
  flexShrink: 0,
};
