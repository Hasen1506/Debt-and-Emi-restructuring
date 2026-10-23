/**
 * A log of every change the person makes: payments, spends, loans, goals,
 * tax inputs, letters, imports and settings. Newest first. Each line says
 * what changed and, where it matters, the value before and after.
 *
 * Stored in localStorage (`rightdue_change_log`) and synced as the
 * `change_log` slice. The monthly "What changed" card is a pure reading
 * of this log (lib/what-changed.ts).
 */
import type { ActivityEntry } from './activity';
import type { AssetPayload, Country, IncomeStreamPayload, LoanPayload, UserPayload } from './api';
import { loanLabel } from './loan-types';

export const CHANGE_LOG_KEY = 'rightdue_change_log';

export type ChangeKind =
  | 'payment'
  | 'spend'
  | 'loan'
  | 'prepayment'
  | 'goal'
  | 'asset'
  | 'income'
  | 'tax'
  | 'letter'
  | 'import'
  | 'settings';

export interface ChangeEntry {
  id: string;
  /** ISO datetime in UTC; the screen formats it in the person's zone. */
  at: string;
  kind: ChangeKind;
  /** One line: what changed. */
  what: string;
  before?: string;
  after?: string;
  /** The month the change is about, 'YYYY-MM', when that isn't `at`. */
  month?: string;
  /** Activity, spend or goal id, so the row can be undone. */
  refId?: string;
}

const MAX = 400;

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function isEntry(v: unknown): v is ChangeEntry {
  if (!v || typeof v !== 'object') return false;
  const e = v as Partial<ChangeEntry>;
  return typeof e.id === 'string' && typeof e.at === 'string' && typeof e.kind === 'string' && typeof e.what === 'string';
}

export function readChangeLog(): ChangeEntry[] {
  const raw = storage()?.getItem(CHANGE_LOG_KEY);
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter(isEntry) : [];
  } catch {
    return [];
  }
}

function write(entries: ChangeEntry[]): void {
  const store = storage();
  if (!store) return;
  store.setItem(CHANGE_LOG_KEY, JSON.stringify(entries.slice(0, MAX)));
  void import('./server-sync').then(({ syncSliceToServer }) => syncSliceToServer('change_log', entries.slice(0, MAX)));
}

export function recordChange(draft: Omit<ChangeEntry, 'id' | 'at'> & { id?: string; at?: string }): ChangeEntry {
  const entry: ChangeEntry = {
    id: draft.id ?? `ch_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    at: draft.at ?? new Date().toISOString(),
    kind: draft.kind,
    what: draft.what,
    ...(draft.before !== undefined ? { before: draft.before } : {}),
    ...(draft.after !== undefined ? { after: draft.after } : {}),
    ...(draft.month ? { month: draft.month } : {}),
    ...(draft.refId ? { refId: draft.refId } : {}),
  };
  write([entry, ...readChangeLog()]);
  return entry;
}

export function recordChanges(drafts: Array<Omit<ChangeEntry, 'id' | 'at'>>): void {
  if (drafts.length === 0) return;
  const at = new Date().toISOString();
  const added = drafts.map((d, i) => ({
    id: `ch_${Date.now().toString(36)}_${i}_${Math.random().toString(36).slice(2, 6)}`,
    at,
    ...d,
  }));
  write([...added.reverse(), ...readChangeLog()]);
}

/** Drop one row (the correction path for a logged change). */
export function removeChange(id: string): ChangeEntry[] {
  const next = readChangeLog().filter((e) => e.id !== id);
  write(next);
  return next;
}

const money = (v: string | number | null | undefined) => {
  const n = Number(v ?? '');
  return Number.isFinite(n) ? String(Math.round(n)) : '';
};

/** "₹2,50,000" or "$2,500", whole. Kept here, not from api.ts: this module
 *  is loaded on most pages, and api.ts would come with it. */
export function wholeMoney(n: number, currency: 'INR' | 'USD'): string {
  const s = new Intl.NumberFormat(currency === 'USD' ? 'en-US' : 'en-IN', { maximumFractionDigits: 0 }).format(Math.abs(Math.round(n)));
  return `${n < 0 ? '-' : ''}${currency === 'USD' ? '$' : '₹'}${s}`;
}

/** "₹2,50,000" in the loan's own currency; '' when blank. */
function amount(v: string | number | null | undefined, l: LoanPayload, country: Country): string {
  const n = money(v);
  return n === '' ? '' : wholeMoney(Number(n), (l.currency as 'INR' | 'USD' | undefined) ?? (country === 'US' ? 'USD' : 'INR'));
}

function rate(v: string | null | undefined): string {
  const n = Number(v ?? '');
  return v && Number.isFinite(n) ? `${(n * 100).toFixed(2)}%` : '';
}

/** A card has a payment, not an EMI; a US loan has a payment too. */
function paymentWord(l: LoanPayload, country: Country): string {
  return l.loan_type === 'credit_card' || country === 'US' ? 'payment' : 'EMI';
}

/** "balance ₹2,50,000, 13.50% a year, EMI ₹9,800, 30 months left": the
 *  figures only, since the row already names the loan. */
function loanLine(l: LoanPayload, country: Country): string {
  const bits = [`balance ${amount(l.outstanding, l, country) || 'not set'}`];
  if (rate(l.nominal_rate)) bits.push(`${rate(l.nominal_rate)} a year`);
  if (amount(l.scheduled_emi, l, country)) bits.push(`${paymentWord(l, country)} ${amount(l.scheduled_emi, l, country)}`);
  if (l.loan_type !== 'credit_card' && (l.tenure_months_remaining ?? 0) > 0) bits.push(`${l.tenure_months_remaining} months left`);
  return bits.join(', ');
}

/** Same loan on both sides: matched by id, else by identical figures (a
 *  loan that only gained an id on load is not "removed" and "added"). */
function pairLoans(prev: LoanPayload[], next: LoanPayload[]) {
  const sig = (l: LoanPayload) =>
    [l.loan_type, l.bank ?? '', money(l.outstanding), l.nominal_rate ?? '', money(l.scheduled_emi), l.tenure_months_remaining ?? ''].join('|');
  const used = new Set<number>();
  const match = new Map<number, number>();
  next.forEach((l, j) => {
    const i = l.id ? prev.findIndex((p, k) => !used.has(k) && p.id === l.id) : -1;
    if (i >= 0) { used.add(i); match.set(j, i); }
  });
  next.forEach((l, j) => {
    if (match.has(j)) return;
    const i = prev.findIndex((p, k) => !used.has(k) && sig(p) === sig(l));
    if (i >= 0) { used.add(i); match.set(j, i); }
  });
  // Without ids, an edited loan is the one left over with the same type and
  // lender, when there is exactly one such loan on each side. Two different
  // ids are two different loans.
  const kind = (l: LoanPayload) => `${l.loan_type}|${(l.bank ?? '').trim().toLowerCase()}`;
  next.forEach((l, j) => {
    if (match.has(j)) return;
    const olds = prev.flatMap((p, k) => (!used.has(k) && kind(p) === kind(l) && !(p.id && l.id) ? [k] : []));
    const news = next.filter((n, m) => !match.has(m) && kind(n) === kind(l));
    if (olds.length === 1 && news.length === 1) { used.add(olds[0]); match.set(j, olds[0]); }
  });
  return {
    pairs: next.map((l, j) => [match.has(j) ? prev[match.get(j)!] : undefined, l] as const),
    removed: prev.filter((_, k) => !used.has(k)),
  };
}

/** What a profile save changed, one entry per difference. */
export function profileChanges(before: UserPayload | null, after: UserPayload): Array<Omit<ChangeEntry, 'id' | 'at'>> {
  if (!before) return [{ kind: 'settings', what: 'Profile saved', after: 'created' }];
  const out: Array<Omit<ChangeEntry, 'id' | 'at'>> = [];
  const country = after.country;
  const { pairs, removed } = pairLoans(before.loans ?? [], after.loans ?? []);
  for (const [old, l] of pairs) {
    if (!old) {
      out.push({
        kind: l.imported_from === 'credit_report' ? 'import' : 'loan',
        what: `${l.imported_from === 'credit_report' ? 'Imported' : 'Added'} ${loanLabel(l)}`,
        after: loanLine(l, country),
      });
      continue;
    }
    const bits: string[] = [];
    if (money(old.outstanding) !== money(l.outstanding)) bits.push(`balance ${amount(old.outstanding, old, country) || 'not set'} → ${amount(l.outstanding, l, country) || 'not set'}`);
    if ((old.nominal_rate || '') !== (l.nominal_rate || '')) bits.push(`rate ${rate(old.nominal_rate) || 'not set'} → ${rate(l.nominal_rate) || 'not set'}`);
    if (money(old.scheduled_emi) !== money(l.scheduled_emi)) bits.push(`${paymentWord(l, country)} ${amount(old.scheduled_emi, old, country) || 'not set'} → ${amount(l.scheduled_emi, l, country) || 'not set'}`);
    if (old.tenure_months_remaining !== l.tenure_months_remaining) bits.push(`months left ${old.tenure_months_remaining ?? 0} → ${l.tenure_months_remaining ?? 0}`);
    if ((old.repayment || 'emi') !== (l.repayment || 'emi')) bits.push(`repayment ${old.repayment || 'emi'} → ${l.repayment || 'emi'}`);
    if (bits.length) out.push({ kind: 'loan', what: `Edited ${loanLabel(l)}`, before: loanLine(old, country), after: bits.join('; ') });
  }
  for (const l of removed) out.push({ kind: 'loan', what: `Removed ${loanLabel(l)}`, before: loanLine(l, country), after: 'removed' });
  const fields: Array<[ChangeKind, string, string, string]> = [
    ['income', 'Take-home pay', money(before.monthly_income), money(after.monthly_income)],
    ['spend', 'Monthly spending figure', String(Number(before.fixed_expenses || 0) + Number(before.variable_expenses || 0)), String(Number(after.fixed_expenses || 0) + Number(after.variable_expenses || 0))],
    ['tax', 'Tax regime', before.tax_regime || '', after.tax_regime || ''],
    ['settings', 'Country', before.country, after.country],
    ['income', 'Income type', before.income_type || '', after.income_type || ''],
  ];
  for (const [kind, what, b, a] of fields) {
    if (b !== a) out.push({ kind, what, before: b, after: a });
  }
  const stream = (s: IncomeStreamPayload) => `${s.kind} ${s.gross_annual}`;
  const bs = (before.income_streams ?? []).map(stream).sort().join('; ');
  const as = (after.income_streams ?? []).map(stream).sort().join('; ');
  if (bs !== as) out.push({ kind: 'tax', what: 'Income other than salary', before: bs || 'none', after: as || 'none' });
  const asset = (x: AssetPayload) => `${x.label || x.asset_type} ${x.current_market_value}`;
  const ba = (before.assets ?? []).map(asset).sort().join('; ');
  const aa = (after.assets ?? []).map(asset).sort().join('; ');
  if (ba !== aa) out.push({ kind: 'asset', what: 'Assets', before: ba || 'none', after: aa || 'none' });
  return out;
}

const PAYMENT_WHAT: Record<ActivityEntry['kind'], string> = {
  paid_full: 'Payment',
  paid_partial: 'Part payment',
  missed: 'Missed payment',
  paid_extra: 'Extra payment',
  closed: 'Loan closed',
  balance_correction: 'Balance correction',
};

/** Payments added, edited or removed between two activity lists. */
export function activityChanges(before: ActivityEntry[], after: ActivityEntry[]): Array<Omit<ChangeEntry, 'id' | 'at'>> {
  const out: Array<Omit<ChangeEntry, 'id' | 'at'>> = [];
  const prev = new Map(before.map((e) => [e.id, e]));
  const next = new Map(after.map((e) => [e.id, e]));
  for (const e of after) {
    const old = prev.get(e.id);
    const month = e.date.slice(0, 7);
    if (!old) {
      out.push({
        kind: e.kind === 'paid_extra' ? 'prepayment' : 'payment',
        what: `${PAYMENT_WHAT[e.kind] ?? 'Payment'} recorded`,
        after: e.amount,
        before: e.scheduledEmi,
        month,
        refId: e.id,
      });
    } else if (old.amount !== e.amount || old.kind !== e.kind) {
      out.push({
        kind: 'payment',
        what: 'Payment edited',
        before: `${(PAYMENT_WHAT[old.kind] ?? 'payment').toLowerCase()} ${old.amount}`,
        after: `${(PAYMENT_WHAT[e.kind] ?? 'payment').toLowerCase()} ${e.amount}`,
        month,
        refId: e.id,
      });
    }
  }
  for (const e of before) {
    if (!next.has(e.id)) {
      out.push({ kind: 'payment', what: 'Payment removed', before: `${(PAYMENT_WHAT[e.kind] ?? 'payment').toLowerCase()} ${e.amount}`, after: 'removed', month: e.date.slice(0, 7), refId: e.id });
    }
  }
  return out;
}

/** One plan fact per month, replaced when the figure changes, so "What
 *  changed" can quote the debt-free date and the interest without
 *  running the plan again. Returns the same array when nothing moved. */
export function withPlanFacts(
  entries: ChangeEntry[],
  facts: { month: string; debtFree: string; interest: string },
): ChangeEntry[] {
  const same = (what: string, after: string) =>
    entries.find((e) => e.kind === 'settings' && e.month === facts.month && e.what === what && e.after === after);
  if (same('Debt-free date', facts.debtFree) && same('Interest on the plan', facts.interest)) return entries;
  const rest = entries.filter((e) => !(e.kind === 'settings' && e.month === facts.month && (e.what === 'Debt-free date' || e.what === 'Interest on the plan')));
  const prevFree = entries.find((e) => e.kind === 'settings' && e.what === 'Debt-free date');
  const prevInt = entries.find((e) => e.kind === 'settings' && e.what === 'Interest on the plan');
  const at = new Date().toISOString();
  const add = (what: string, after: string, before?: string): ChangeEntry => ({
    id: `ch_plan_${facts.month}_${what.slice(0, 4)}`,
    at,
    kind: 'settings',
    what,
    after,
    month: facts.month,
    ...(before && before !== after ? { before } : {}),
  });
  return [add('Debt-free date', facts.debtFree, prevFree?.after), add('Interest on the plan', facts.interest, prevInt?.after), ...rest];
}

/** Record this month's debt-free date and plan interest when they differ
 *  from the last note. The "What changed" card reads only the log. */
export function savePlanFacts(facts: { month: string; debtFree: string; interest: string }): ChangeEntry[] {
  const cur = readChangeLog();
  const next = withPlanFacts(cur, facts);
  if (next === cur) return cur;
  write(next);
  return next;
}
