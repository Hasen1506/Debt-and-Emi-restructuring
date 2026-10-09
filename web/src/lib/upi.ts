/**
 * Pay via UPI (roadmap PR H): a `upi://pay` intent link for a loan's
 * payment, opened by the phone's UPI app (GPay, PhonePe, Paytm, BHIM, the
 * bank's own app). The app only builds the link; the user approves the
 * payment in their UPI app and then marks it paid here.
 *
 * Link parameters (NPCI UPI linking specification):
 *   pa  payee VPA (required) — the lender's collection UPI ID the user enters per loan
 *   pn  payee name
 *   am  amount, rupees with two decimals
 *   cu  currency, always INR (UPI moves rupees only)
 *   tn  transaction note (shown to both sides)
 */
import type { LoanPayload } from './api';

/** A UPI ID: handle@provider, e.g. "hdfcbankcc.12345@hdfcbank". */
const VPA_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{1,255}@[a-zA-Z][a-zA-Z0-9.-]{1,63}$/;

/** UPI caps a payment to a verified loan collector at ₹5,00,000 (NPCI,
 *  from 15 Sep 2025; ₹10,00,000 a day). Banks and apps may set their own
 *  lower cap, often ₹1,00,000: above that a payment can be refused. */
export const UPI_LOAN_LIMIT = 500000;
export const UPI_TYPICAL_LIMIT = 100000;

/** What to say about the cap for a payment of `amount` rupees, or null. */
export function upiLimitNote(amount: number): string | null {
  if (amount > UPI_LOAN_LIMIT) return 'Over ₹5,00,000, UPI’s limit for one loan payment: split it, or pay by net banking. ';
  if (amount > UPI_TYPICAL_LIMIT) return 'UPI allows up to ₹5,00,000 for a loan payment, but your bank or app may cap it lower. ';
  return null;
}
const NOTE_MAX = 50;

export function normalizeVpa(v: string | undefined | null): string {
  return (v ?? '').trim().toLowerCase();
}

export function isValidVpa(v: string | undefined | null): boolean {
  return VPA_RE.test(normalizeVpa(v));
}

/** Why a typed UPI ID can't be saved, or null. */
export function vpaError(v: string): string | null {
  if (!v.trim()) return 'Enter the UPI ID your lender gave for repayments, e.g. loans.123@hdfcbank.';
  return isValidVpa(v) ? null : 'That isn’t a UPI ID. It looks like name@bank, e.g. loans.123@hdfcbank.';
}

/** Only rupee loans with a saved UPI ID can be paid by UPI. */
export function canPayByUpi(loan: Pick<LoanPayload, 'upi_vpa' | 'currency'> | undefined, currency: string): boolean {
  return !!loan && currency === 'INR' && isValidVpa(loan.upi_vpa);
}

export function upiNote(loanName: string, month: string): string {
  return `${loanName} ${month}`.replace(/[^\w .,/-]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, NOTE_MAX);
}

/** The `upi://pay` link. Throws on a bad UPI ID or amount: callers check first. */
export function upiPayLink({ vpa, name, amount, note }: { vpa: string; name?: string; amount: number; note?: string }): string {
  if (!isValidVpa(vpa)) throw new Error('invalid UPI ID');
  if (!(Number.isFinite(amount) && amount > 0)) throw new Error('invalid amount');
  const q = new URLSearchParams();
  q.set('pa', normalizeVpa(vpa));
  if (name?.trim()) q.set('pn', name.trim().slice(0, 50));
  q.set('am', amount.toFixed(2));
  q.set('cu', 'INR');
  if (note?.trim()) q.set('tn', note.trim().slice(0, NOTE_MAX));
  // URLSearchParams writes spaces as "+", which some UPI apps show literally.
  return `upi://pay?${q.toString().replace(/\+/g, '%20')}`;
}
