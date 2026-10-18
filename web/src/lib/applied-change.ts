/** Apply flow (founder, 18 Oct 2026): the latest change a tap saved, the plan
 *  before → after, and its exact undo. Shown until dismissed; previews never write it. */
import Decimal from 'decimal.js';
import { readActivityClient, removeActivityEntry } from './activity';
import type { CompareResponse, Country } from './api';
import { commitActivity } from './commit-activity';
import { undoSpendingCut } from './commit-spending-cut';
import { readCommitmentsClient, removeCommitment, writeCommitmentsClient } from './commitments';
import { resolveLoanIndex } from './loan-ids';
import { loadProfileClient, saveProfileClient } from './user-store';

const KEY = 'rightdue_applied_change';
export const APPLIED_CHANGE_EVENT = 'rightdue:applied-change';

export interface PlanFigures { debtFreeMonth: number | null; totalInterest: string | null }

type EmiEdit = { loanId?: string; loanIndex: number; before: string; after: string };
export type AppliedUndo =
  | { kind: 'lump_sum'; activityId: string; commitmentId?: string; emi?: EmiEdit }
  | { kind: 'spending_cut'; commitmentId: string }
  | { kind: 'tenure'; loanId?: string; loanIndex: number; before: { tenure: number; emi: string }; after: { tenure: number; emi: string } };

/** `what` "₹50,000 paid to HDFC"; `from` when it takes effect; `budgetHolds`: a cut
 *  the debt budget won't pass on; `bankNote`: tenure, the bank must confirm. */
export interface AppliedChange {
  id: string; country: Country; currency: 'INR' | 'USD'; what: string; from: string;
  before: PlanFigures; after: PlanFigures; budgetHolds?: 'unset' | 'min'; bankNote?: boolean;
  undo: AppliedUndo; undone?: boolean;
}

/** The plan's own figures (baseline_*) or the plan with the change (scenario_*). */
export function planFigures(r: CompareResponse | null | undefined, side: 'baseline' | 'scenario'): PlanFigures {
  const m = r?.[`${side}_debt_free_month`];
  const i = r?.[`${side}_total_interest`];
  const never = r?.[`${side}_never_clears`];
  return { debtFreeMonth: m ?? null, totalInterest: never || i == null ? null : String(i) };
}

export function readAppliedChange(): AppliedChange | null {
  if (typeof window === 'undefined') return null;
  try { const v = JSON.parse(window.localStorage.getItem(KEY) ?? 'null'); return v?.undo ? (v as AppliedChange) : null; } catch { return null; }
}

function publish(c: AppliedChange | null) {
  if (c) window.localStorage.setItem(KEY, JSON.stringify(c));
  else window.localStorage.removeItem(KEY);
  if (typeof window.dispatchEvent === 'function' && typeof Event !== 'undefined') window.dispatchEvent(new Event(APPLIED_CHANGE_EVENT));
}

export function recordAppliedChange(c: Omit<AppliedChange, 'id'>): AppliedChange {
  const full = { ...c, id: `chg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}` };
  publish(full);
  return full;
}

export const dismissAppliedChange = (): void => publish(null);

/** Undo the change exactly: remove what it logged, put back what it overwrote.
 *  Refuses (changing nothing) when a later edit touched the same values. */
export function undoAppliedChange(c: AppliedChange): void {
  const u = c.undo;
  if (u.kind === 'spending_cut') undoSpendingCut(u.commitmentId);
  else if (u.kind === 'lump_sum') undoLumpSum(u);
  else undoTenure(u);
  publish({ ...c, undone: true });
}

function undoLumpSum(u: Extract<AppliedUndo, { kind: 'lump_sum' }>) {
  const entries = readActivityClient();
  if (!entries.some((e) => e.id === u.activityId)) throw new Error('That payment is no longer in Activity, so there is nothing to undo here.');
  const stored = loadProfileClient();
  let user = stored.user;
  if (u.emi) {
    const emi = u.emi;
    const i = resolveLoanIndex({ loanIndex: emi.loanIndex, loanId: emi.loanId }, user.loans);
    if (!user.loans[i] || !new Decimal(user.loans[i].scheduled_emi || '0').eq(emi.after))
      throw new Error('This loan’s EMI changed after the payment. Nothing was undone; edit it in Profile instead.');
    user = { ...user, loans: user.loans.map((l, k) => (k === i ? { ...l, scheduled_emi: emi.before } : l)) };
  }
  commitActivity(removeActivityEntry(entries, u.activityId), user);
  if (u.emi && !saveProfileClient({ ...stored, user })) {
    commitActivity(entries, stored.user);
    throw new Error('The EMI could not be restored. Nothing was undone.');
  }
  if (u.commitmentId) writeCommitmentsClient(removeCommitment(readCommitmentsClient(), u.commitmentId));
}

/** Save a longer tenure and its lower EMI on the profile loan. */
export function applyTenure(ref: { loanIndex: number; loanId?: string }, extraMonths: number, newEmi: string | number): Extract<AppliedUndo, { kind: 'tenure' }> {
  const stored = loadProfileClient();
  if (!stored.isLive) throw new Error('Finish setup first so the new tenure can be saved.');
  const i = resolveLoanIndex(ref, stored.user.loans);
  const loan = stored.user.loans[i];
  if (!loan || loan.loan_type === 'credit_card') throw new Error('This loan changed. Refresh the plan and try again.');
  const before = { tenure: loan.tenure_months_remaining, emi: loan.scheduled_emi };
  const after = { tenure: before.tenure + extraMonths, emi: new Decimal(newEmi).toDecimalPlaces(2).toString() };
  if (!(extraMonths > 0) || !new Decimal(after.emi).lt(before.emi || '0') || !new Decimal(after.emi).gt(0))
    throw new Error('This tenure doesn’t lower the EMI, so there is nothing to save.');
  const loans = stored.user.loans.map((l, k) => (k === i ? { ...l, tenure_months_remaining: after.tenure, scheduled_emi: after.emi } : l));
  if (!saveProfileClient({ ...stored, user: { ...stored.user, loans } })) throw new Error('The new tenure could not be saved. Your loan is unchanged.');
  return { kind: 'tenure', loanId: loan.id, loanIndex: i, before, after };
}

function undoTenure(u: Extract<AppliedUndo, { kind: 'tenure' }>) {
  const stored = loadProfileClient();
  const i = resolveLoanIndex({ loanIndex: u.loanIndex, loanId: u.loanId }, stored.user.loans);
  const loan = stored.user.loans[i];
  if (!loan || loan.tenure_months_remaining !== u.after.tenure || !new Decimal(loan.scheduled_emi || '0').eq(u.after.emi))
    throw new Error('This loan was edited after the change. Nothing was undone; edit it in Profile instead.');
  const loans = stored.user.loans.map((l, k) => (k === i ? { ...l, tenure_months_remaining: u.before.tenure, scheduled_emi: u.before.emi } : l));
  if (!saveProfileClient({ ...stored, user: { ...stored.user, loans } })) throw new Error('The loan could not be restored. Nothing was undone.');
}
