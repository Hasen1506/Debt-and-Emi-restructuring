/**
 * Stable loan ids.
 *
 * Activity entries used to name their loan by its position in the list.
 * Removing a loan in Setup shifted every later position, so a ₹19,000
 * payment logged on HDFC showed up under ICICI and cut ICICI's balance, and
 * an ICICI entry could drop out of the plan altogether. Each loan now has an
 * id that stays with it; entries carry it and are pointed back at the loan's
 * current position when they're read.
 *
 * The API ignores the field, so loans can be sent to it unchanged.
 */
import type { LoanPayload } from './api';

export function newLoanId(): string {
  const raw =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().replace(/-/g, '')
      : `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  return `L${raw.slice(0, 10)}`;
}

/** The loans with an id on each, keeping the ones they have. A repeated id
 *  (a loan copied with its fields) gets a new one. The same array comes back
 *  when nothing was missing. */
export function withLoanIds(loans: LoanPayload[]): LoanPayload[] {
  const seen = new Set<string>();
  let changed = false;
  const out = loans.map((l) => {
    if (l.id && !seen.has(l.id)) {
      seen.add(l.id);
      return l;
    }
    changed = true;
    let id = newLoanId();
    while (seen.has(id)) id = newLoanId();
    seen.add(id);
    return { ...l, id };
  });
  return changed ? out : loans;
}

export interface LoanRef {
  loanId?: string;
  loanIndex: number;
}

/** Where the referenced loan sits in `loans` now, or -1 when it's gone. By
 *  id when the entry and the list have them; by position for entries
 *  logged before ids, or a list read before they were added. */
export function resolveLoanIndex(ref: LoanRef, loans: Pick<LoanPayload, 'id'>[]): number {
  if (ref.loanId && loans.some((l) => l.id)) {
    return loans.findIndex((l) => l.id === ref.loanId);
  }
  return ref.loanIndex >= 0 && ref.loanIndex < loans.length ? ref.loanIndex : -1;
}

/** Each entry pointed at its loan's current position (-1 when the loan was
 *  removed), and an entry logged before ids given the id of the loan at its
 *  position. The same array comes back when nothing changed. */
export function alignToLoans<T extends LoanRef>(entries: T[], loans: Pick<LoanPayload, 'id'>[]): T[] {
  let changed = false;
  const out = entries.map((e) => {
    const idx = resolveLoanIndex(e, loans);
    const loanId = e.loanId ?? (idx >= 0 ? loans[idx].id : undefined);
    if (idx === e.loanIndex && loanId === e.loanId) return e;
    changed = true;
    return { ...e, loanIndex: idx, ...(loanId ? { loanId } : {}) };
  });
  return changed ? out : entries;
}
