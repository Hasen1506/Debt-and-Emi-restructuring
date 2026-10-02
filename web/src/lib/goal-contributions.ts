/**
 * Goal contributions ledger — user-recorded "I put ₹X into Goal Y on date Z".
 *
 * The engine needs `saved_so_far` per goal so each month's run-rate
 * reflects how much is still missing rather than the full funded
 * amount. Without a ledger, every month says "you need full amount
 * over N months" — including months *after* you've already saved
 * most of it. With the ledger, run-rate shrinks as contributions
 * accumulate, freeing surplus for other goals.
 *
 * Mirrors the activity-ledger pattern:
 *   • localStorage for unbounded history
 *   • cookie digest of {goalId → totalSaved} so server-side
 *     `goalsForSimulateServer` can pass saved_so_far to the engine
 *     without reading localStorage
 *
 * Pure log. No engine integration beyond the cookie digest — the
 * engine just consumes `saved_so_far` on each GoalIn it receives.
 */

import { persistGoalSlices, type GoalSliceWrite } from './persist-goal-slices';

export interface GoalContributionEntry {
  id: string;
  goalId: string;
  /** Amount put into the goal, decimal string. Always positive. */
  amount: string;
  /** ISO date 'YYYY-MM-DD' of the contribution event. */
  date: string;
  /** Optional source tag — 'surplus', 'bonus', 'gift', 'liquidation', etc.
   *  Pure metadata; the engine doesn't branch on it. */
  source?: string;
  /** Optional free-text note. */
  note?: string;
  /** When the entry was logged. */
  loggedAt: string;
}

const STORAGE_KEY = 'finoptima_goal_contributions';
const DIGEST_COOKIE = 'finoptima_goal_contributions_digest';

function safeParse(raw: string | null): GoalContributionEntry[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    return v.filter(isValid);
  } catch {
    return [];
  }
}

function isValid(v: unknown): v is GoalContributionEntry {
  if (!v || typeof v !== 'object') return false;
  const e = v as Partial<GoalContributionEntry>;
  return (
    typeof e.id === 'string' &&
    typeof e.goalId === 'string' &&
    typeof e.amount === 'string' &&
    typeof e.date === 'string'
  );
}

export function readContributionsClient(): GoalContributionEntry[] {
  if (typeof localStorage === 'undefined') return [];
  return safeParse(localStorage.getItem(STORAGE_KEY));
}

export function writeContributionsClient(entries: GoalContributionEntry[]): void {
  if (typeof localStorage === 'undefined') return;
  persistGoalSlices([contributionSliceWrite(entries)]);
}

export function contributionSliceWrite(entries: GoalContributionEntry[]): GoalSliceWrite {
  return { key: STORAGE_KEY, cookie: DIGEST_COOKIE, digest: btoa(JSON.stringify(totalsByGoal(entries))), value: entries, slice: 'goal_contributions' };
}

export function newContributionId(): string {
  return `gc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Add a contribution. Returns a new array with the entry prepended. */
export function addContribution(
  entries: GoalContributionEntry[],
  draft: Omit<GoalContributionEntry, 'id' | 'loggedAt'>,
): GoalContributionEntry[] {
  const entry: GoalContributionEntry = {
    ...draft,
    id: newContributionId(),
    loggedAt: new Date().toISOString(),
  };
  return [entry, ...entries];
}

export function removeContribution(
  entries: GoalContributionEntry[],
  id: string,
): GoalContributionEntry[] {
  return entries.filter((e) => e.id !== id);
}

/** Per-goal saved totals. Sums positive amounts; entries with bad data
 *  contribute zero. Used by the cookie digest + run-rate math. */
export function totalsByGoal(
  entries: GoalContributionEntry[],
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const e of entries) {
    const v = Number(e.amount || '0');
    if (!Number.isFinite(v) || v <= 0) continue;
    out[e.goalId] = (out[e.goalId] ?? 0) + v;
  }
  return out;
}

export function totalSavedForGoal(
  entries: GoalContributionEntry[],
  goalId: string,
): number {
  return totalsByGoal(entries)[goalId] ?? 0;
}

// ─── Server-side cookie reader ─────────────────────────────────────────────

/** Read the cookie-digest mirror of per-goal totals server-side. Used
 *  by `goalsForSimulateServer` to populate each goal's `saved_so_far`
 *  before sending to the engine. Empty object → engine defaults
 *  saved_so_far to 0 (full required amount remaining). */
export async function readContributionTotalsServer(): Promise<Record<string, number>> {
  const { cookies } = await import('next/headers');
  const raw = cookies().get(DIGEST_COOKIE)?.value;
  if (!raw) return {};
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
    if (!parsed || typeof parsed !== 'object') return {};
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(parsed)) {
      const num = Number(v);
      if (Number.isFinite(num) && num > 0) out[k] = num;
    }
    return out;
  } catch {
    return {};
  }
}
