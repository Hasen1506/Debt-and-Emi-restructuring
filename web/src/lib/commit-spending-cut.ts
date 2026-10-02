import type { UserPayload } from './api';
import { formatCurrency } from './api';
import { userDefaultCurrency } from './currency';
import { addCommitment, readCommitmentsClient, todayISO, type CommitmentEntry } from './commitments';
import { loadProfileClient, saveProfileClient } from './user-store';
import { syncSliceToServer } from './server-sync';
import Decimal from 'decimal.js';

/** Commit an immediate cut against today's saved budget, preserving profile
 * metadata. A failed save must not leave a success entry in the log. */
export function commitSpendingCut(expected: UserPayload, amount: number, startMonth: number): CommitmentEntry[] {
  if (startMonth !== 1) throw new Error('Future cuts are previews. Choose this month to save your spending change.');
  const stored = loadProfileClient();
  if (!stored.isLive) throw new Error('Finish setup first so the cut can be saved.');
  const variable = Number(expected.variable_expenses || 0) > 0;
  const key = variable ? 'variable_expenses' : 'fixed_expenses';
  const current = Number(stored.user[key] || 0);
  if (stored.user.country !== expected.country || Number(stored.user[key] || 0) !== Number(expected[key] || 0) ||
      (Number(stored.user.variable_expenses || 0) > 0) !== variable ||
      !Number.isFinite(current) || !Number.isFinite(amount) || amount <= 0 || amount > current) {
    throw new Error('Your spending changed. Refresh the plan and check the cut again.');
  }
  const nextAmount = new Decimal(stored.user[key] || '0').sub(amount).toDecimalPlaces(2).toString();
  const currency = userDefaultCurrency(stored.user.country);
  const label = variable ? 'variable spending' : 'fixed expenses';
  const next = addCommitment(readCommitmentsClient(), {
    date: todayISO(), kind: 'surplus_cut', amount: String(amount),
    note: `Cut ${label} ${formatCurrency(current, currency)} → ${formatCurrency(nextAmount, currency)}`,
  });
  const storageKey = 'finoptima_commitments';
  const before = localStorage.getItem(storageKey);
  try {
    const serialized = JSON.stringify(next);
    localStorage.setItem(storageKey, serialized);
    if (localStorage.getItem(storageKey) !== serialized) throw new Error('The commitment could not be saved.');
    if (!saveProfileClient({...stored, user:{...stored.user,[key]:String(nextAmount)}})) {
      throw new Error('The cut could not be saved. Your spending remains unchanged.');
    }
  } catch (error) {
    if (before === null) localStorage.removeItem(storageKey);
    else localStorage.setItem(storageKey, before);
    throw error;
  }
  void syncSliceToServer('commitments', next);
  return next;
}
