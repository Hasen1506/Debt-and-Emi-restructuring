/**
 * Decision log — recommendations the app surfaced, the user's choice,
 * and (later) the actual outcome.
 *
 * Mirrors the activity-ledger pattern but for *advisory* moments rather
 * than payment events. The app frequently recommends an action — sell
 * this asset, fund this goal, prepay this loan, take this loan — and
 * the user executes externally. Without a log, the recommender can
 * never learn whether its estimates held: estimated post-tax proceeds
 * may differ from actuals; estimated EMI may differ from the sanction
 * letter; "this goal is achievable" may have been wrong.
 *
 * Each entry has three phases:
 *   1. `recommended`  — app suggested an action with an estimated amount.
 *                       User has not yet acted.
 *   2. `accepted` / `declined` — user chose to act (or not). Locked in.
 *   3. `reconciled`   — user reported the actual outcome after acting.
 *                       Now we can compare estimate vs. actual.
 *
 * The schema is intentionally simple (no engine integration yet):
 * the data exists so the user can self-audit and the recommender can
 * calibrate later. localStorage-only for now; a future pass can mirror
 * to the server-sync slice for cross-device continuity.
 */

import { syncSliceToServer } from './server-sync';

export type DecisionKind =
  | 'liquidation'     // Sell asset to clear debt / fund goal.
  | 'goal_fund'       // Fund a goal from surplus / EF / liquidation / new loan.
  | 'prepay'          // Extra principal payment on a specific loan.
  | 'new_loan'        // Take on a new EMI for a planned purchase.
  | 'expense_commit'  // Committed to cut monthly expenses by a fixed amount.
  | 'other';

export type DecisionStatus =
  | 'recommended'
  | 'accepted'
  | 'declined'
  | 'reconciled';

export interface DecisionRecommendation {
  /** Free-text context — "Goal: wedding", "Sell ICICI ETF to clear personal loan". */
  context: string;
  /** App-estimated cash amount the action moves, in user residence ccy.
   *  For liquidation: estimated post-tax net proceeds. For goal_fund:
   *  required amount. For prepay: extra principal applied. For
   *  expense_commit: monthly delta the user committed to cut. */
  estimatedAmount: string;
  /** Short narrative the app used to justify the recommendation — kept
   *  so the user can see *why* this was suggested when they reconcile
   *  weeks later. */
  reasoning?: string;
  /** Optional source identifier (e.g. tool slug, goal ID, loan index).
   *  Lets a future calibration step group recommendations by surface. */
  source?: string;
  /** Kind-specific structured data the discard / display paths need to
   *  consume without parsing prose. For `expense_commit` this carries
   *  `{ previousFixedExpenses, newFixedExpenses, effectiveMonth,
   *  goalId }` so undo can restore the prior profile and the ledger
   *  can render an honest "from X to Y" line. Other kinds can stash
   *  their own structured payloads here. */
  metadata?: Record<string, string>;
}

export interface DecisionOutcome {
  /** Date the action actually happened. YYYY-MM-DD. */
  actualDate: string;
  /** What the user actually netted / paid, in user residence ccy. */
  actualAmount: string;
  /** Optional free-text on why it differed (price drift, fee surprise,
   *  buyer haggling, NAV move). */
  notes?: string;
}

export interface DecisionEntry {
  id: string;
  kind: DecisionKind;
  status: DecisionStatus;
  recommendation: DecisionRecommendation;
  /** When the recommendation was logged. ISO timestamp. */
  recommendedAt: string;
  /** Set when status becomes accepted/declined. ISO timestamp. */
  decidedAt?: string;
  /** Populated once the user reports the actual outcome. */
  outcome?: DecisionOutcome;
}

// Distinct from `decisions.ts`'s `rightdue_decisions` key — that ledger
// tracks user-made plan choices with snapshot/undo. This one tracks
// app-issued advisory recommendations + calibration data. They used to
// share a key and silently clobber each other.
const STORAGE_KEY = 'rightdue_decision_log';
const LEGACY_KEY = 'rightdue_decisions';
const MIGRATION_FLAG = 'rightdue_decision_log_migrated_v1';

/**
 * One-shot salvage from the legacy `rightdue_decisions` key. Before the
 * key rename, this module wrote decision-log entries under
 * `rightdue_decisions` — the same key `decisions.ts` uses for plan-
 * choice entries, so the two silently clobbered each other depending on
 * write order. Now that the keys are split, walk the legacy key one
 * time at first read, salvage anything that matches the decision-log
 * shape via `isValid` (plan-choice entries fail the shape check and are
 * left where they are), and merge into the new key.
 *
 * Idempotent — the flag prevents repeat migration on subsequent reads.
 * Cheap to skip — flag is checked first.
 */
function migrateFromLegacyKey(): void {
  if (typeof localStorage === 'undefined') return;
  if (localStorage.getItem(MIGRATION_FLAG)) return;
  try {
    const legacyRaw = localStorage.getItem(LEGACY_KEY);
    const salvaged = safeParse(legacyRaw);
    if (salvaged.length > 0) {
      const current = safeParse(localStorage.getItem(STORAGE_KEY));
      const seen = new Set(current.map((e) => e.id));
      const merged = [
        ...current,
        ...salvaged.filter((e) => !seen.has(e.id)),
      ];
      localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
    }
  } catch {
    // Salvage is best-effort; localStorage may throw under quota
    // pressure. Setting the flag below either way so we don't retry
    // every read.
  }
  try { localStorage.setItem(MIGRATION_FLAG, '1'); } catch { /* A read remains usable when browser storage is full. */ }
}

function safeParse(raw: string | null): DecisionEntry[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    return v.filter(isValid);
  } catch {
    return [];
  }
}

function isValid(v: unknown): v is DecisionEntry {
  if (!v || typeof v !== 'object') return false;
  const d = v as Partial<DecisionEntry>;
  return (
    typeof d.id === 'string' &&
    typeof d.kind === 'string' &&
    typeof d.status === 'string' &&
    typeof d.recommendedAt === 'string' &&
    !!d.recommendation
  );
}

export function readDecisionsClient(): DecisionEntry[] {
  if (typeof localStorage === 'undefined') return [];
  migrateFromLegacyKey();
  return safeParse(localStorage.getItem(STORAGE_KEY));
}

export function writeDecisionsClient(entries: DecisionEntry[]): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  void syncSliceToServer('decision_log', entries);
}

export function newDecisionId(): string {
  return `d_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Record a new recommendation in the log (status = 'recommended'). */
export function logRecommendation(
  entries: DecisionEntry[],
  kind: DecisionKind,
  rec: DecisionRecommendation,
): DecisionEntry[] {
  const entry: DecisionEntry = {
    id: newDecisionId(),
    kind,
    status: 'recommended',
    recommendation: rec,
    recommendedAt: new Date().toISOString(),
  };
  return [entry, ...entries];
}

/**
 * Update an existing entry's recommendation payload in place. Used by
 * DecisionLogControls when the tool inputs change while a tracked
 * (still-recommended) entry exists — we'd rather update the estimate
 * than spawn a new orphan row that the user never explicitly decided
 * on. Status stays at 'recommended'; only `recommendation` is
 * overwritten.
 */
export function updateRecommendation(
  entries: DecisionEntry[],
  id: string,
  rec: DecisionRecommendation,
): DecisionEntry[] {
  return entries.map((e) =>
    e.id === id ? { ...e, recommendation: rec } : e,
  );
}

/**
 * Find the most-recent unreconciled (recommended / accepted / declined)
 * entry for a given (kind, source) pair. Used by DecisionLogControls to
 * decide whether `record()` should spawn a new row or update an existing
 * one. Returns null when nothing matches — caller should logRecommendation.
 *
 * Matching on `(kind, source)` instead of `(kind, source, context,
 * estimatedAmount)` means tweaking tool inputs replaces the prior entry
 * in place rather than abandoning it as an orphan. To track two distinct
 * purchases on the same tool, reconcile or discard the first before
 * starting the second.
 */
export function findActiveEntry(
  entries: DecisionEntry[],
  kind: DecisionKind,
  source: string | undefined,
): DecisionEntry | null {
  const normalizedSource = source ?? null;
  for (const e of entries) {
    if (e.kind !== kind) continue;
    if ((e.recommendation.source ?? null) !== normalizedSource) continue;
    if (e.status === 'reconciled') continue;
    return e;
  }
  return null;
}

/** Move a recommendation to accepted or declined (locked-in decision). */
export function decideRecommendation(
  entries: DecisionEntry[],
  id: string,
  decision: 'accepted' | 'declined',
): DecisionEntry[] {
  return entries.map((e) =>
    e.id === id
      ? { ...e, status: decision, decidedAt: new Date().toISOString() }
      : e,
  );
}

/** Attach an actual outcome — moves status to 'reconciled'. */
export function reconcileDecision(
  entries: DecisionEntry[],
  id: string,
  outcome: DecisionOutcome,
): DecisionEntry[] {
  return entries.map((e) =>
    e.id === id ? { ...e, status: 'reconciled', outcome } : e,
  );
}

/** Drop an entry by id. Used to clean up abandoned recommendations the
 *  user tracked but never reconciled (changed the inputs, walked away,
 *  etc.) — without this the log accumulates orphan `recommended` rows
 *  forever and inflates localStorage. */
export function deleteDecision(
  entries: DecisionEntry[],
  id: string,
): DecisionEntry[] {
  return entries.filter((e) => e.id !== id);
}

/** Prune orphan `recommended`-only entries older than `maxAgeDays`.
 *  Reconciled / accepted / declined entries are preserved (they carry
 *  real signal for calibration). Returns a new array — does not mutate. */
export function pruneStaleRecommendations(
  entries: DecisionEntry[],
  maxAgeDays = 30,
  now: Date = new Date(),
): DecisionEntry[] {
  const cutoff = now.getTime() - maxAgeDays * 24 * 60 * 60 * 1000;
  return entries.filter((e) => {
    if (e.status !== 'recommended') return true;
    const t = Date.parse(e.recommendedAt);
    if (!Number.isFinite(t)) return true; // keep if timestamp is unparseable
    return t >= cutoff;
  });
}

// ─── Estimate vs actual analysis ───────────────────────────────────────────

export interface CalibrationStats {
  /** How many reconciled entries were considered. */
  sampleSize: number;
  /** Mean signed pct difference: (actual − estimate) / estimate.
   *  Positive = actuals tend to beat the estimate; negative = shortfall. */
  meanSignedPctDelta: number;
  /** Mean absolute pct difference — how off our estimates were in
   *  either direction. */
  meanAbsPctDelta: number;
  /** Worst single shortfall (most negative pct delta) in the sample. */
  worstShortfallPct: number;
}

/**
 * Quick calibration summary over reconciled decisions. Useful for
 * "your estimates tend to undershoot by X%" badges or for adjusting
 * future recommendations' confidence intervals. Zero sample size →
 * all stats are zero (caller should check `sampleSize`).
 *
 * When `source` is provided, the sample narrows to that tool only —
 * /tools/purchase calibration shouldn't be muddied by /tools/new-debt
 * entries even though both share `kind === 'new_loan'`. Pass `undefined`
 * to aggregate across all sources.
 */
export function summarizeCalibration(
  entries: DecisionEntry[],
  kind?: DecisionKind,
  source?: string,
): CalibrationStats {
  const sample = entries.filter(
    (e) =>
      e.status === 'reconciled' &&
      e.outcome &&
      (kind == null || e.kind === kind) &&
      (source == null || e.recommendation.source === source) &&
      Number(e.recommendation.estimatedAmount) > 0,
  );
  if (sample.length === 0) {
    return {
      sampleSize: 0,
      meanSignedPctDelta: 0,
      meanAbsPctDelta: 0,
      worstShortfallPct: 0,
    };
  }
  let signedSum = 0;
  let absSum = 0;
  let worst = 0;
  for (const e of sample) {
    const est = Number(e.recommendation.estimatedAmount);
    const act = Number(e.outcome!.actualAmount);
    const pct = (act - est) / est;
    signedSum += pct;
    absSum += Math.abs(pct);
    if (pct < worst) worst = pct;
  }
  return {
    sampleSize: sample.length,
    meanSignedPctDelta: signedSum / sample.length,
    meanAbsPctDelta: absSum / sample.length,
    worstShortfallPct: worst,
  };
}
