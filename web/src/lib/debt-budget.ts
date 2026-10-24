/**
 * The user's own monthly total for debts: EMIs, card minimums and the
 * extra on top, in their currency. The plan never pays more than this; what
 * it doesn't pay stays with the user. Minimums are paid even when they're
 * above it.
 *
 * Founder, 18 Oct 2026: it is the user's choice, never a silent default.
 * The cookie holds one of
 *   'all'    all spare cash (chosen),
 *   'min'    only EMIs and minimums (chosen),
 *   amount   a set total,
 *   nothing  not chosen yet: the plan pays EMIs and minimums only and asks
 *            "How much a month toward debts?" once, on Plan (TO DEBTS).
 *            Home shows the saved figure and links there.
 * A budget saved before this (an amount) is untouched; "all spare cash"
 * used to be stored as nothing, so those users are asked once.
 */

import Decimal from 'decimal.js';

const COOKIE_NAME = 'rightdue_debt_budget';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export type DebtBudgetKind = 'unset' | 'all' | 'min' | 'set';

/** A positive amount with at most two decimals, else ''. */
export function normalizeDebtBudgetAmount(v: string | null | undefined): string {
  const raw = String(v ?? '').replace(/[,₹$\s]/g, '');
  if (!/^\d+(?:\.\d*)?$/.test(raw)) return '';
  const n = new Decimal(raw).toDecimalPlaces(2);
  return n.isFinite() && n.gt(0) ? n.toString() : '';
}

/** The stored token: 'all', 'min', an amount, or '' (not chosen). */
export function normalizeDebtBudget(v: string | null | undefined): string {
  const raw = String(v ?? '').trim();
  if (raw === 'all' || raw === 'min') return raw;
  return normalizeDebtBudgetAmount(raw);
}

/** The words on Plan's TO DEBTS chip and Home's read-only line. `amount`
 *  is already formatted ("₹45,000"); pass '' unless the choice is a set total. */
export function debtBudgetChoiceLabel(
  choice: DebtBudgetKind,
  amount: string,
  currency: 'INR' | 'USD',
  nothingSpare = false,
  /** Part of the spare goes to the emergency fund first. */
  fundFirst = false,
): string {
  const emi = currency === 'USD' ? 'PAYMENTS' : 'EMIS';
  if (choice === 'set' && amount) return `${amount} A MONTH`;
  if (choice === 'unset') return `${emi} AND MINIMUMS ONLY — CHOOSE AN AMOUNT`;
  if (choice === 'min' || nothingSpare) return `${emi} AND MINIMUMS ONLY`;
  return fundFirst ? `${emi} + SPARE CASH AFTER THE FUND` : `${emi} + ALL SPARE CASH`;
}

export function debtBudgetKind(token: string): DebtBudgetKind {
  const t = normalizeDebtBudget(token);
  return t === '' ? 'unset' : t === 'all' ? 'all' : t === 'min' ? 'min' : 'set';
}

/** The set amount, or '' for every other choice. */
export function debtBudgetAmount(token: string): string {
  return debtBudgetKind(token) === 'set' ? normalizeDebtBudget(token) : '';
}

/** What /simulate gets: the amount; nothing for all spare cash; '0' (EMIs
 *  and minimums only) when that's chosen or nothing is chosen yet. A guest
 *  plan (no saved profile) keeps all spare cash. */
export function debtBudgetForEngine(token: string, live = true): string | undefined {
  const kind = debtBudgetKind(token);
  if (kind === 'set') return debtBudgetAmount(token);
  if (kind === 'all' || (kind === 'unset' && !live)) return undefined;
  return '0';
}

export function readDebtBudgetClient(): string {
  if (typeof document === 'undefined') return '';
  const match = document.cookie.match(new RegExp(`(?:^|; )${COOKIE_NAME}=([^;]*)`));
  return normalizeDebtBudget(match ? decodeURIComponent(match[1]) : null);
}

export function writeDebtBudgetClient(value: string, sync = true) {
  if (typeof document === 'undefined') return;
  const v = normalizeDebtBudget(value);
  document.cookie = v
    ? `${COOKIE_NAME}=${v}; path=/; max-age=${COOKIE_MAX_AGE}; SameSite=Lax`
    : `${COOKIE_NAME}=; path=/; max-age=0; SameSite=Lax`;
  if (readDebtBudgetClient() !== v) throw new Error('The monthly debt budget could not be saved.');
  if (sync) void import('./server-sync').then(({ syncSliceToServer }) => syncSliceToServer('debt_budget', v));
}

export async function loadDebtBudgetServer(): Promise<string> {
  const { cookies } = await import('next/headers');
  return normalizeDebtBudget((await cookies()).get(COOKIE_NAME)?.value);
}
