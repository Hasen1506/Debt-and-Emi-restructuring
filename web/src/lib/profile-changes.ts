/**
 * What a profile save changed, one change-log entry per difference. Its own
 * module: only a profile save needs it, and user-store loads it on demand,
 * so it stays off the first load of every page that logs a payment.
 */
import type { AssetPayload, Country, IncomeStreamPayload, LoanPayload, UserPayload } from './api';
import { money, wholeMoney, type ChangeEntry, type ChangeKind } from './change-log';
import { loanLabel } from './loan-types';

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

