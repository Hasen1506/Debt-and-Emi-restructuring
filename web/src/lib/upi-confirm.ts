/**
 * "Did it go through?" after PAY VIA UPI (founder note on #2).
 *
 * A web page that opens a `upi://pay` link gets nothing back: the UPI app
 * doesn't report to the page, and RightDue isn't the payee, so no payment
 * gateway or bank tells us either (docs/retention/UPI-CONFIRMATION.md has
 * the research). The honest loop is to ask, and to remember the ask:
 *
 *   YES  → recorded as paid (the same as MARK PAID).
 *   NO   → nothing recorded; what to do if money left the account anyway.
 *   NOT SURE → kept as a check for later, with the UPI reference number
 *          (UTR, 12 digits, on the UPI app's receipt and the bank SMS) if
 *          the user has it; Home asks again next visit.
 *
 * Kept on this device only (localStorage).
 */

export interface PendingUpi {
  /** The Pay-this-month row key. */
  key: string;
  name: string;
  amount: number;
  vpa: string;
  /** When the UPI app was opened, ISO. */
  openedAt: string;
  /** "2026-10", the plan month it was for. */
  month: string;
  utr?: string;
}

export const UPI_PENDING_KEY = 'rightdue_upi_checks';
const MAX = 20;

/** A UPI transaction reference (UTR / RRN) is 12 digits. */
export function utrError(raw: string): string | null {
  const s = raw.replace(/\s+/g, '');
  if (!s) return null; // optional
  return /^\d{12}$/.test(s) ? null : 'The UPI reference number is 12 digits, on your UPI app’s receipt or the bank SMS.';
}

export function readPending(): PendingUpi[] {
  try {
    const raw = JSON.parse(window.localStorage.getItem(UPI_PENDING_KEY) || '[]');
    return Array.isArray(raw) ? raw.filter((p) => p && typeof p.key === 'string' && Number(p.amount) > 0) : [];
  } catch {
    return [];
  }
}

function write(list: PendingUpi[]): void {
  try {
    window.localStorage.setItem(UPI_PENDING_KEY, JSON.stringify(list.slice(-MAX)));
  } catch {
    /* the check lasts this visit */
  }
}

/** One open check per row and month: a second NOT SURE replaces the first. */
export function upsertPending(list: PendingUpi[], p: PendingUpi): PendingUpi[] {
  return [...list.filter((x) => !(x.key === p.key && x.month === p.month)), p].slice(-MAX);
}

export function removePending(list: PendingUpi[], key: string, month: string): PendingUpi[] {
  return list.filter((x) => !(x.key === key && x.month === month));
}

export function savePending(p: PendingUpi): void {
  write(upsertPending(readPending(), p));
}

export function clearPending(key: string, month: string): void {
  write(removePending(readPending(), key, month));
}

/** Checks to raise again: opened at least `minHours` ago. */
export function dueChecks(list: PendingUpi[], now: Date, minHours = 2): PendingUpi[] {
  return list.filter((p) => now.getTime() - new Date(p.openedAt).getTime() >= minHours * 3600_000);
}

/** What to say after NO. RBI's turnaround rule for failed UPI payments
 *  (circular DPSS.CO.PD.No.629/02.14.006/2019-20, 20 Sep 2019): paid to a
 *  business (a lender's UPI ID is one) and the account was debited without
 *  the payee confirming it: reversed within T+5 days (T = the day of the
 *  payment), ₹100 a day to the payer after that.
 *  https://www.rbi.org.in/Scripts/NotificationUser.aspx?Id=11693 */
export const UPI_FAILED_NOTE =
  'Nothing is recorded. If money left your account but the lender didn’t get it, your bank must reverse it within 5 days (RBI’s rule for failed UPI payments to a business), and pay you ₹100 a day after that. Pay again only once you’re sure the first one failed, and before the due date.';
