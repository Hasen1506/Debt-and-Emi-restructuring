import {
  logRecommendation,
  readDecisionsClient,
  type DecisionEntry,
} from './decision-log';
import { loadProfileClient, saveProfileClient } from './user-store';
import Decimal from 'decimal.js';
import { countryMonthKey } from './today';
import { syncSliceToServer } from './server-sync';

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
  /** YYYY-MM the cut takes effect. Only the current month is supported. */
  effectiveMonth?: string;
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
  const currentMonth = countryMonthKey(profile.user.country);
  if (!Number.isFinite(params.monthlyDelta) || params.monthlyDelta <= 0 || params.monthlyDelta > fixed + variable) return null;
  if (params.effectiveMonth && params.effectiveMonth !== currentMonth) return null;

  const variableCut = new Decimal(params.monthlyDelta).mul(variable).div(fixed + variable).toDecimalPlaces(2);
  const newFixedStr = new Decimal(fixed).sub(new Decimal(params.monthlyDelta).sub(variableCut)).toFixed(2);
  const newVariableStr = new Decimal(variable).sub(variableCut).toFixed(2);
  const effectiveMonth = currentMonth;

  // Prepare both records; roll back the decision if the profile cannot save.
  const updatedUser = {
    ...profile.user,
    fixed_expenses: newFixedStr,
    variable_expenses: newVariableStr,
  };

  const ccySym = profile.user.country === 'IN' ? '₹' : '$';
  const goalLabel = params.goalLabel ?? 'a goal';
  const reasoning = `Cut ${ccySym}${Math.round(params.monthlyDelta).toLocaleString(profile.user.country === 'IN' ? 'en-IN' : 'en-US')} a month to fund ${goalLabel}. Starts ${effectiveMonth}.`;

  const entries = logRecommendation(readDecisionsClient(), 'expense_commit', {
    context: `Expense reduction · ${goalLabel}`,
    estimatedAmount: new Decimal(params.monthlyDelta).toFixed(2),
    reasoning,
    source: params.goalId ? `goals:${params.goalId}` : 'goals',
    metadata: {
      previousFixedExpenses: String(fixed),
      previousVariableExpenses: String(variable),
      newFixedExpenses: newFixedStr,
      newVariableExpenses: newVariableStr,
      monthlyDelta: new Decimal(params.monthlyDelta).toFixed(2),
      effectiveMonth,
      goalId: params.goalId ?? '',
    },
  });
  const before = localStorage.getItem('rightdue_decision_log');
  try {
    localStorage.setItem('rightdue_decision_log', JSON.stringify(entries));
    if (!saveProfileClient({ ...profile, user: updatedUser })) throw new Error('The spending change could not be saved.');
  } catch {
    try {
      if (before == null) localStorage.removeItem('rightdue_decision_log'); else localStorage.setItem('rightdue_decision_log', before);
    } catch { /* A blocked unchanged decision key must still return a failed commit. */ }
    return null;
  }
  void syncSliceToServer('decision_log', entries);

  return {
    entry: entries[0],
    newFixedExpenses: Number(newFixedStr),
    newVariableExpenses: Number(newVariableStr),
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
  if (Number(profile.user.fixed_expenses) !== Number(meta.newFixedExpenses) || Number(profile.user.variable_expenses || 0) !== Number(meta.newVariableExpenses || 0)) return false;
  return saveProfileClient({
    ...profile,
    user: {
      ...profile.user,
      fixed_expenses: prevFixed,
      variable_expenses: prevVariable ?? '0',
    },
  });
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
