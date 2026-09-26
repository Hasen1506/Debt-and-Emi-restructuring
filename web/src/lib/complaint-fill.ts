/**
 * Fill a complaint letter's placeholders in the browser.
 *
 * The API never sees a borrower's name or account number: it returns
 * "[Full name]", "[Loan account number]" and so on, and this swaps them
 * for what the borrower typed. A blank optional line (phone, email,
 * address) is dropped rather than left as a bracket; a blank name or
 * account stays as a bracket so the gap is obvious before sending.
 */
import type { ComplaintPlaceholders } from './api';

export interface Borrower {
  name: string;
  account: string;
  phone: string;
  email: string;
  address: string;
}

export const EMPTY_BORROWER: Borrower = { name: '', account: '', phone: '', email: '', address: '' };

export function fillLetter(text: string, ph: ComplaintPlaceholders, b: Borrower): string {
  const values: [string, string][] = [
    [ph.name, b.name.trim()],
    [ph.account, b.account.trim()],
    [ph.phone, b.phone.trim()],
    [ph.email, b.email.trim()],
    [ph.address, b.address.trim()],
  ];
  const lines = text.split('\n').filter((line) => {
    const t = line.trim();
    if (!ph.optional_lines.includes(t)) return true;
    return values.some(([token, v]) => token === t && v !== '');
  });
  let out = lines.join('\n');
  for (const [token, v] of values) {
    if (v) out = out.split(token).join(v);
  }
  return out;
}

/** Placeholders still showing, in plain words, for a "Still needed" line. */
export function missingDetails(b: Borrower, text: string, ph: ComplaintPlaceholders): string[] {
  const out: string[] = [];
  if (text.includes(ph.bank_name)) out.push("the bank's name (pick the lender above and check again)");
  if (!b.name.trim()) out.push('your full name');
  if (!b.account.trim()) out.push('your loan account number');
  return out;
}
