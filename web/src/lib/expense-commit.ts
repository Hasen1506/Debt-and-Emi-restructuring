/**
 * Expense-commit flow — the user agrees to cut their monthly expenses
 * by a fixed amount to close a goal-funding gap.
 *
 * Sequence on commit:
 *   1. Mutate `profile.user.fixed_expenses` (and `variable_expenses` if
 *      it's the larger of the two — see `applyDelta` below).
 *   2. Persist via `saveProfileClient`.
 *   3. Write a `decision_log` entry of kind `expense_commit` with the
 *      prior value stashed in `metadata` so undo is exact.
 *
 * On undo (DecisionLogControls.discard branch for `expense_commit`):
 *   1. Read `previousFixedExpenses` + `previousVariableExpenses` from
 *      the entry's metadata.
 *   2. Restore them on the profile + save.
 *   3. Delete the decision-log entry.
 *
 * The activity-ledger surfacing isn't done here — it's handled at
 * render time by mixing decision-log expense_commit entries into the
 * ledger timeline (see ActivityLedger.tsx). Keeping the storage in
 * one place avoids the two-store sync problem (where deleting one
 * leaves the other dangling).
 */

import {
  logRecommendation,
  readDecisionsClient,
  writeDecisionsClient,
  type DecisionEntry,
} from './decision-log';
import { loadProfileClient, saveProfileClient } from './user-store';

export interface ExpenseCommitParams {
  /** Monthly expense reduction the user commits to (positive number,
   *  user-residence ccy). Splits across fixed / variable buckets in
   *  proportion to their current values; falls back to all-fixed when
   *  variable is zero (the common case — most profiles run combined
   *  mode and store everything in `fixed_expenses`). */
  monthlyDelta: number;
  /** Goal the commitment was triggered by — surfaced in the entry so
   *  the user can see *why* they committed weeks later. Optional —
   *  pass `undefined` for free-standing expense cuts. */
  goalId?: string;
  /** Short label of the source goal for human-readable context. */
  goalLabel?: string;
  /** YYYY-MM the cut takes effect. Defaults to next month (current
   *  month is mostly already spent; committing mid-cycle is mis-
   *  leading). */
  effectiveMonth?: string;
}

/** Splits a positive delta across fixed / variable in proportion to
 *  the current split. Pure helper — does not touch storage. */
function applyDelta(
  fixed: number,
  variable: number,
  monthlyDelta: number,
): { fixed: number; variable: number } {
  const total = fixed + variable;
  if (total <= 0 || monthlyDelta <= 0) {
    return { fixed: Math.max(0, fixed), variable: Math.max(0, variable) };
  }
  // Cap delta at total so we don't push either bucket negative.
  const effective = Math.min(monthlyDelta, total);
  const variableShare = variable / total;
  const variableCut = effective * variableShare;
  const fixedCut = effective - variableCut;
  return {
    fixed: Math.max(0, fixed - fixedCut),
    variable: Math.max(0, variable - variableCut),
  };
}

function nextMonthIso(today: Date = new Date()): string {
  const y = today.getFullYear();
  const m = today.getMonth() + 1; // 0-indexed → next month = month+1
  if (m > 11) return `${y + 1}-01`;
  return `${y}-${String(m + 1).padStart(2, '0')}`;
}

export interface ExpenseCommitResult {
  /** The newly-created decision-log entry (id, metadata, etc). */
  entry: DecisionEntry;
  /** Post-commit expense values, for the UI to render immediately
   *  without re-loading the profile. */
  newFixedExpenses: number;
  newVariableExpenses: number;
}

/**
 * Mutate the profile + write the decision-log entry. Returns the
 * created entry so the caller can scroll-to / highlight it.
 */
export function commitExpenseReduction(
  params: ExpenseCommitParams,
): ExpenseCommitResult | null {
  const profile = loadProfileClient();
  const fixed = Number(profile.user.fixed_expenses || '0');
  const variable = Number(profile.user.variable_expenses || '0');
  if (params.monthlyDelta <= 0) return null;

  const next = applyDelta(fixed, variable, params.monthlyDelta);
  const newFixedStr = next.fixed.toFixed(0);
  const newVariableStr = next.variable.toFixed(0);
  const effectiveMonth = params.effectiveMonth ?? nextMonthIso();

  // Mutate + save first so the decision-log entry never references a
  // commitment that didn't actually land. If save fails (cookie quota,
  // etc.) the caller sees null and no entry is written.
  const updatedUser = {
    ...profile.user,
    fixed_expenses: newFixedStr,
    variable_expenses: newVariableStr,
  };
  saveProfileClient({ ...profile, user: updatedUser });

  const ccySym = profile.user.country === 'IN' ? '₹' : '$';
  const goalLabel = params.goalLabel ?? 'a goal';
  const reasoning = `Cut ${ccySym}${Math.round(params.monthlyDelta).toLocaleString()}/mo to fund ${goalLabel}. Starts ${effectiveMonth}.`;

  const entries = logRecommendation(readDecisionsClient(), 'expense_commit', {
    context: `Expense reduction · ${goalLabel}`,
    estimatedAmount: String(Math.round(params.monthlyDelta)),
    reasoning,
    source: params.goalId ? `goals:${params.goalId}` : 'goals',
    metadata: {
      previousFixedExpenses: String(fixed),
      previousVariableExpenses: String(variable),
      newFixedExpenses: newFixedStr,
      newVariableExpenses: newVariableStr,
      monthlyDelta: String(Math.round(params.monthlyDelta)),
      effectiveMonth,
      goalId: params.goalId ?? '',
    },
  });
  writeDecisionsClient(entries);

  return {
    entry: entries[0],
    newFixedExpenses: next.fixed,
    newVariableExpenses: next.variable,
  };
}

/**
 * Inverse of `commitExpenseReduction`. Restores the prior fixed +
 * variable expense values from the entry's metadata snapshot and
 * persists. Caller is responsible for deleting the decision-log
 * entry afterwards (the discard handler in DecisionLogControls does
 * both — restore first so a save failure leaves the entry intact).
 *
 * Idempotent / safe to call with a non-expense_commit entry: returns
 * false without mutating profile when metadata is missing.
 */
export function undoExpenseCommit(entry: DecisionEntry): boolean {
  if (entry.kind !== 'expense_commit') return false;
  const meta = entry.recommendation.metadata;
  if (!meta) return false;
  const prevFixed = meta.previousFixedExpenses;
  const prevVariable = meta.previousVariableExpenses;
  if (prevFixed == null) return false;
  const profile = loadProfileClient();
  saveProfileClient({
    ...profile,
    user: {
      ...profile.user,
      fixed_expenses: prevFixed,
      variable_expenses: prevVariable ?? '0',
    },
  });
  return true;
}

/**
 * Filter decision-log entries to the expense_commit subset, sorted
 * newest-first. Used by ActivityLedger and the goals reconcile-nudge
 * banner. Reads live storage each call — cheap.
 */
export function readExpenseCommits(): DecisionEntry[] {
  return readDecisionsClient()
    .filter((e) => e.kind === 'expense_commit')
    .sort((a, b) => (a.recommendedAt < b.recommendedAt ? 1 : -1));
}

/**
 * Stale = unreconciled `expense_commit` entries older than 30 days.
 * The user committed but never said whether the cut actually held;
 * the plan has been silently treating it as real that whole time. We
 * surface a nudge so they reconcile or undo.
 */
export function staleExpenseCommits(
  entries: DecisionEntry[] = readExpenseCommits(),
  maxAgeDays = 30,
  now: Date = new Date(),
): DecisionEntry[] {
  const cutoff = now.getTime() - maxAgeDays * 24 * 60 * 60 * 1000;
  return entries.filter((e) => {
    if (e.kind !== 'expense_commit') return false;
    if (e.status === 'reconciled' || e.status === 'declined') return false;
    const t = Date.parse(e.recommendedAt);
    return Number.isFinite(t) && t < cutoff;
  });
}
