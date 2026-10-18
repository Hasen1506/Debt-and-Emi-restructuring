import type { UserPayload } from './api';
import { formatCurrency } from './api';
import { userDefaultCurrency } from './currency';
import { addCommitment, readCommitmentsClient, removeCommitment, todayISO, type CommitmentEntry } from './commitments';
import { loadProfileClient, saveProfileClient } from './user-store';
import { debtBudgetForEngine, debtBudgetKind, readDebtBudgetClient, writeDebtBudgetClient } from './debt-budget';
import Decimal from 'decimal.js';

/** Commit an immediate cut against today's saved budget, preserving profile
 * metadata. A failed save must not leave a success entry in the log. */
export function commitSpendingCut(expected: UserPayload, amount: number, startMonth: number, expectedBudget?: string): CommitmentEntry[] {
  if (startMonth !== 1) throw new Error('Future cuts are previews. Choose this month to save your spending change.');
  const stored = loadProfileClient();
  if (!stored.isLive) throw new Error('Finish setup first so the cut can be saved.');
  const variable = Number(expected.variable_expenses || 0) > 0;
  const key = variable ? 'variable_expenses' : 'fixed_expenses';
  const current = Number(stored.user[key] || 0);
  const budgetBefore = readDebtBudgetClient();
  // `expectedBudget` is what the plan sent /simulate (runArgs.debt_budget).
  if (expectedBudget !== undefined && (debtBudgetForEngine(budgetBefore, stored.isLive) ?? '') !== expectedBudget) {
    throw new Error('Your monthly debt budget changed. Refresh the plan and check the cut again.');
  }
  if (stored.user.country !== expected.country || Number(stored.user[key] || 0) !== Number(expected[key] || 0) ||
      (Number(stored.user.variable_expenses || 0) > 0) !== variable ||
      !Number.isFinite(current) || !Number.isFinite(amount) || amount <= 0 || amount > current) {
    throw new Error('Your spending changed. Refresh the plan and check the cut again.');
  }
  const nextAmount = new Decimal(stored.user[key] || '0').sub(amount).toDecimalPlaces(2).toString();
  // A set total grows by the cut; 'all', 'min' or not chosen stay as they are.
  const budgetAfter = debtBudgetKind(budgetBefore) === 'set' ? new Decimal(budgetBefore).add(amount).toDecimalPlaces(2).toString() : budgetBefore;
  const currency = userDefaultCurrency(stored.user.country);
  const label = variable ? 'variable spending' : 'fixed expenses';
  const next = addCommitment(readCommitmentsClient(), {
    date: todayISO(), kind: 'surplus_cut', amount: String(amount),
    note: `Cut ${label} ${formatCurrency(current, currency)} → ${formatCurrency(nextAmount, currency)}`,
    spendingSnapshot: { country: stored.user.country, key, before: String(stored.user[key] || '0'), after: nextAmount,
      debtBudgetBefore: budgetBefore, debtBudgetAfter: budgetAfter },
  });
  persistCut(stored, key, nextAmount, budgetBefore, budgetAfter, next);
  return next;
}

/** Undo only while both saved values still match this cut's snapshot. */
export function undoSpendingCut(id: string): CommitmentEntry[] {
  const entries = readCommitmentsClient();
  const snapshot = entries.find((e) => e.id === id)?.spendingSnapshot;
  if (!snapshot) throw new Error('This older cut has no saved snapshot. Edit spending in Profile to reverse it.');
  const stored = loadProfileClient();
  if (!stored.isLive || stored.user.country !== snapshot.country ||
      !new Decimal(stored.user[snapshot.key] || '0').eq(snapshot.after) ||
      readDebtBudgetClient() !== snapshot.debtBudgetAfter) {
    throw new Error('Spending or the monthly debt budget changed after this cut. Undo the latest change first, or edit Profile and Plan.');
  }
  const next = removeCommitment(entries, id);
  persistCut(stored, snapshot.key, snapshot.before, snapshot.debtBudgetAfter, snapshot.debtBudgetBefore, next);
  return next;
}

function persistCut(stored: ReturnType<typeof loadProfileClient>, key: 'fixed_expenses' | 'variable_expenses',
  expenses: string, budgetBefore: string, budgetAfter: string, next: CommitmentEntry[]) {
  const storageKey = 'rightdue_commitments';
  const before = localStorage.getItem(storageKey);
  try {
    const serialized = JSON.stringify(next);
    localStorage.setItem(storageKey, serialized);
    if (localStorage.getItem(storageKey) !== serialized) throw new Error('The commitment could not be saved.');
    // Verify the cookie before the profile save, which publishes the three
    // slices together. A blocked cookie or profile rolls everything back.
    writeDebtBudgetClient(budgetAfter, false);
    if (!saveProfileClient({...stored, user:{...stored.user,[key]:expenses}},
      { debt_budget: budgetAfter, commitments: next })) {
      throw new Error('The cut could not be saved. Your spending remains unchanged.');
    }
  } catch (error) {
    try {
      writeDebtBudgetClient(budgetBefore, false);
    } finally {
      if (before === null) localStorage.removeItem(storageKey);
      else localStorage.setItem(storageKey, before);
    }
    throw error;
  }
}
