/**
 * Decisions ledger — every plan-affecting choice the user makes
 * (toggling a setting, applying a recommendation, adding/editing a
 * goal, ending an income stream). Distinct from the activity ledger
 * (`activity.ts`), which records *payment events*.
 *
 * Why two ledgers: payment events change the projection because of
 * what happened with money; decisions change the projection because
 * of what the user *chose*. Showing them together would conflate cause
 * and effect — power users want to audit each independently.
 *
 * Each decision carries:
 *   • snapshot — JSON of the field/value before the change. Enables
 *     soft-undo without re-simulating.
 *   • impactDeltaMonths — change in debt-free-month attributable to
 *     this decision (positive = pushed out, negative = pulled in).
 *     Computed at decision time by comparing pre/post simulations.
 *     null when not computed (UI shows "—").
 *
 * Persistence: localStorage + server sync. Pre-auth: empty.
 */

import { syncSliceToServer } from './server-sync';

export type DecisionKind =
  | 'strategy_change'
  | 'inflation_toggle'
  | 'hike_toggle'
  | 'tax_reinvest_toggle'
  | 'fx_drift_toggle'
  | 'ef_split_change'
  | 'plan_start_change'
  | 'goal_added'
  | 'goal_edited'
  | 'goal_removed'
  | 'lifecycle_event_added'
  | 'lifecycle_event_confirmed'
  | 'restructuring_applied'
  | 'income_stream_added'
  | 'income_stream_ended';

export interface DecisionEntry {
  id: string;
  kind: DecisionKind;
  /** ISO timestamp. */
  at: string;
  /** Display label — short, past tense. "Enabled inflation modeling",
   *  "Set EF split to 50%", "Added wedding goal". */
  label: string;
  /** Pre-change snapshot — minimal JSON capturing the field(s) the
   *  decision affected. Used by soft-undo to restore. */
  snapshot: Record<string, unknown>;
  /** Post-change snapshot for completeness. */
  result: Record<string, unknown>;
  /** Change in debt-free-month attributable to the decision. Positive
   *  = delayed; negative = accelerated; null = not yet computed. */
  impactDeltaMonths: number | null;
  /** True after the user has tapped "Undo" on this entry — kept on
   *  the ledger for transparency (we don't physically delete history). */
  reverted: boolean;
}

const STORAGE_KEY = 'finoptima_decisions';
/** Soft-undo only applies to entries within the last N hours; older
 *  decisions are considered "ratified" and undo is hidden. */
export const UNDO_WINDOW_HOURS = 72;

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
  const e = v as Partial<DecisionEntry>;
  return (
    typeof e.id === 'string' &&
    typeof e.kind === 'string' &&
    typeof e.at === 'string' &&
    typeof e.label === 'string'
  );
}

export function readDecisionsClient(): DecisionEntry[] {
  if (typeof localStorage === 'undefined') return [];
  return safeParse(localStorage.getItem(STORAGE_KEY));
}

export function writeDecisionsClient(entries: DecisionEntry[]) {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  void syncSliceToServer('decisions', entries);
}

export function recordDecision(
  entries: DecisionEntry[],
  draft: Omit<DecisionEntry, 'id' | 'at' | 'reverted'>,
): DecisionEntry[] {
  const entry: DecisionEntry = {
    ...draft,
    id: `d_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    at: new Date().toISOString(),
    reverted: false,
  };
  const next = [entry, ...entries].slice(0, 200); // cap log size
  writeDecisionsClient(next);
  return next;
}

export function markReverted(
  entries: DecisionEntry[],
  id: string,
): DecisionEntry[] {
  const next = entries.map((e) => (e.id === id ? { ...e, reverted: true } : e));
  writeDecisionsClient(next);
  return next;
}

export function isWithinUndoWindow(entry: DecisionEntry): boolean {
  if (entry.reverted) return false;
  const at = Date.parse(entry.at);
  if (!Number.isFinite(at)) return false;
  return Date.now() - at <= UNDO_WINDOW_HOURS * 3600 * 1000;
}
