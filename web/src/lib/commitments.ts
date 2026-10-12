/**
 * Commitments log — records when the user converts a /plan what-if slider
 * into a real change.
 *
 * Two kinds today:
 *   • surplus_cut  — recurring monthly cut in fixed_expenses. Mutates
 *                    UserPayload.fixed_expenses and is logged here.
 *   • lump_sum     — one-time extra payment. Written to the activity ledger
 *                    as `paid_extra`, and mirrored here for the changelog.
 *
 * Storage: localStorage (`rightdue_commitments`). Same rationale as the
 * activity ledger — unbounded list, cookie size cap.
 */

export type CommitmentKind = 'surplus_cut' | 'lump_sum';

export interface CommitmentEntry {
  id: string;
  /** ISO date the commitment was made. */
  date: string;
  kind: CommitmentKind;
  /** Amount of the commitment as decimal string. For surplus_cut, the
   *  monthly cut. For lump_sum, the one-time payment amount. */
  amount: string;
  /** For lump_sum, the 0-based loan index it was applied to. */
  loanIndex?: number;
  /** For lump_sum, the bank name of the target loan (snapshot at commit
   *  time so the changelog stays readable even if loans are reordered). */
  loanBank?: string;
  /** Optional human note. */
  note?: string;
  /** Enables a safe undo of cuts saved together with a debt-budget change. */
  spendingSnapshot?: {
    country: 'IN' | 'US';
    key: 'fixed_expenses' | 'variable_expenses';
    before: string;
    after: string;
    debtBudgetBefore: string;
    debtBudgetAfter: string;
  };
}

const STORAGE_KEY = 'rightdue_commitments';

function safeParse(raw: string | null): CommitmentEntry[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isCommitmentEntry);
  } catch {
    return [];
  }
}

function isCommitmentEntry(v: unknown): v is CommitmentEntry {
  if (!v || typeof v !== 'object') return false;
  const e = v as Partial<CommitmentEntry>;
  return (
    typeof e.id === 'string' &&
    typeof e.date === 'string' &&
    (e.kind === 'surplus_cut' || e.kind === 'lump_sum') &&
    typeof e.amount === 'string'
  );
}

export function readCommitmentsClient(): CommitmentEntry[] {
  if (typeof window === 'undefined') return [];
  return safeParse(window.localStorage.getItem(STORAGE_KEY));
}

export function writeCommitmentsClient(entries: CommitmentEntry[]) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  void import('./server-sync').then(({ syncSliceToServer }) =>
    syncSliceToServer('commitments', entries),
  );
}

export function addCommitment(
  entries: CommitmentEntry[],
  draft: Omit<CommitmentEntry, 'id'>,
): CommitmentEntry[] {
  const id =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `cmt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  return [{ ...draft, id }, ...entries];
}

export function removeCommitment(
  entries: CommitmentEntry[],
  id: string,
): CommitmentEntry[] {
  return entries.filter((e) => e.id !== id);
}

export function todayISO(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}
