/**
 * Read Indian bank and card SMS that the user pastes or shares (founder note
 * on grill #3). Runs entirely in the browser: no SMS text is sent anywhere.
 *
 * What it reads, from each message's own words:
 *  - debits and credits (UPI, IMPS/NEFT, card swipes, ATM),
 *  - EMI / NACH / ECS auto-debits for a loan (so a paid EMI can be matched to
 *    the user's loan),
 *  - credit-card spends (a real "new spend this month" figure, grill #25),
 *  - credit-card statement SMS ("Total due … Min due … due by …"),
 * and it skips OTPs and offers ("pre-approved loan of up to …").
 *
 * Why our own parser, not a package: the open-source options (e.g.
 * transaction-sms-parser, MIT, https://github.com/saurabhgupta050890/transaction-sms-parser)
 * cover debits/credits but not EMI auto-debits or statement SMS, and a small
 * file keeps the bundle and supply chain small. No code was copied from them.
 *
 * Automatic reading of the SMS inbox needs an Android app with READ_SMS, which
 * Google Play allows only for the default SMS app or under its declared
 * "SMS-based money management" exception
 * (https://support.google.com/googleplay/android-developer/answer/10208820).
 * A website can't read SMS, so the web flow is paste / share.
 *
 * Nothing is guessed: a part the message doesn't state stays null, and every
 * result keeps the message it came from for the user to check.
 */

export type SmsKind =
  | 'debit'
  | 'credit'
  | 'card_spend'
  | 'emi_debit'
  | 'card_statement'
  | 'emi_bounce'
  | 'otp'
  | 'promo'
  | 'unknown';

export interface ParsedSms {
  kind: SmsKind;
  /** Rupees, as a plain decimal string ("1250.00" → "1250"). */
  amount: string | null;
  /** Last digits of the bank account or loan account named. */
  account_last4: string | null;
  /** Last digits of the card named. */
  card_last4: string | null;
  merchant: string | null;
  /** ISO date when the message states one. */
  date: string | null;
  /** Available balance (or available limit for cards). */
  balance: string | null;
  total_due: string | null;
  min_due: string | null;
  due_date: string | null;
  ref: string | null;
  bank: string | null;
  /** The message as given. */
  text: string;
}

const AMT = String.raw`(?:rs\.?|inr|₹)\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)`;
const AMT_RE = new RegExp(AMT, 'i');

const BANKS: [RegExp, string][] = [
  [/\bhdfc\b/i, 'HDFC Bank'],
  [/\bicici\b/i, 'ICICI Bank'],
  [/\bsbi\b|state bank/i, 'SBI'],
  [/\baxis\b/i, 'Axis Bank'],
  [/\bkotak\b/i, 'Kotak Mahindra Bank'],
  [/\bpnb\b|punjab national/i, 'PNB'],
  [/\bbob\b|bank of baroda/i, 'Bank of Baroda'],
  [/\bcanara\b/i, 'Canara Bank'],
  [/union bank/i, 'Union Bank of India'],
  [/\bidfc\b/i, 'IDFC FIRST Bank'],
  [/\byes bank\b/i, 'Yes Bank'],
  [/indusind/i, 'IndusInd Bank'],
  [/\bfederal\b/i, 'Federal Bank'],
  [/\bau (?:small finance )?bank\b/i, 'AU Small Finance Bank'],
  [/bajaj/i, 'Bajaj Finance'],
];

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

function money(s: string): string {
  const n = s.replace(/,/g, '');
  return n.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function year(y: string): number {
  const n = Number(y);
  return y.length === 2 ? 2000 + n : n;
}

function iso(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

/** The first date in the text: 05-10-26, 05/10/2026, 05-Oct-26, 05Oct26, 5 Oct 2026, 2026-10-05. */
export function findDate(s: string): string | null {
  let m = s.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (m) return iso(Number(m[1]), Number(m[2]), Number(m[3]));
  m = s.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})\b/);
  if (m) return iso(year(m[3]), Number(m[2]), Number(m[1]));
  m = s.match(/\b(\d{1,2})[-\s]?([A-Za-z]{3})[a-z]*[-\s,]?(\d{4}|\d{2})\b/);
  if (m && MONTHS[m[2].toLowerCase()]) return iso(year(m[3]), MONTHS[m[2].toLowerCase()], Number(m[1]));
  return null;
}

function after(re: RegExp, s: string): string | null {
  const m = s.match(re);
  return m ? m[1] : null;
}

function amountAfter(label: string, s: string): string | null {
  const m = s.match(new RegExp(label + String.raw`[^0-9₹]{0,25}?` + AMT, 'i'));
  return m ? money(m[1]) : null;
}

function cleanMerchant(raw: string | null): string | null {
  if (!raw) return null;
  const v = raw.replace(/\s+/g, ' ').trim().replace(/[.,;:-]+$/, '');
  if (v.length < 2 || /^(a\/?c|acct|account|your|card)\b/i.test(v)) return null;
  return v.slice(0, 40);
}

export function parseSms(text: string): ParsedSms {
  const t = text.replace(/\s+/g, ' ').trim();
  const out: ParsedSms = {
    kind: 'unknown', amount: null, account_last4: null, card_last4: null, merchant: null, date: null,
    balance: null, total_due: null, min_due: null, due_date: null, ref: null, bank: null, text,
  };
  for (const [re, name] of BANKS) if (re.test(t)) { out.bank = name; break; }

  if (/\b(otp|one[- ]time password|verification code)\b/i.test(t) && !/\b(debited|credited)\b/i.test(t)) {
    out.kind = 'otp';
    return out;
  }
  const moved = /\b(debited|credited|spent|paid|withdrawn|sent|deducted|received|deposited|transferred|purchase|txn|transaction)\b/i.test(t);
  if (!moved && /\b(pre-?approved|offer|apply now|eligible for|loan of up to|limit increase|click)\b/i.test(t)
      && !/total (?:amt|amount) due|min(?:imum)? (?:amt|amount)? ?due/i.test(t)) {
    out.kind = 'promo';
    return out;
  }

  out.card_last4 = after(/card\s*(?:no\.?\s*)?(?:ending\s*(?:with|in)?\s*|xx+|\*+|x+)\s*[x*]*(\d{4})\b/i, t)
    ?? after(/\b(?:xx+|\*{2,})(\d{4})\b(?=[^.]*card)/i, t);
  out.account_last4 = after(/(?:a\/?c|acct|account|loan a\/?c|loan account)\s*(?:no\.?\s*)?(?:ending\s*(?:with|in)?\s*)?[x*]*\s*(\d{3,6})\b/i, t);
  if (out.account_last4) out.account_last4 = out.account_last4.slice(-4);
  out.balance = amountAfter(String.raw`(?:avl\.?|available|avail\.?)\s*(?:bal(?:ance)?|lmt|limit|credit limit)`, t);
  out.ref = after(/(?:upi\s*ref(?:\s*no)?|ref(?:erence)?\s*(?:no|number)?|txn\s*id|utr)\s*[:.#]?\s*([A-Za-z0-9]{6,22})/i, t);

  // Card statement SMS.
  if (/total (?:amt|amount) due|min(?:imum)?\.? (?:amt|amount)? ?due/i.test(t)) {
    out.kind = 'card_statement';
    out.total_due = amountAfter(String.raw`total (?:amt|amount) due`, t);
    out.min_due = amountAfter(String.raw`min(?:imum)?\.? (?:amt|amount)? ?due`, t);
    const due = t.match(/(?:due (?:by|on|date)|pay by|payment due)\s*[:\-]?\s*([0-9A-Za-z\-/ ,]{5,14})/i);
    out.due_date = due ? findDate(due[1]) : null;
    out.amount = out.total_due;
    return out;
  }

  const amt = t.match(AMT_RE);
  out.amount = amt ? money(amt[1]) : null;
  out.date = findDate(t.replace(new RegExp(AMT, 'gi'), ' '));

  const isEmi = /\b(emi|nach|ecs|e-?mandate|si\b|standing instruction|auto[- ]?debit|loan a\/?c|loan account|instal?ment)\b/i.test(t);
  const bounced = /\b(bounced|dishonou?red|returned unpaid|unpaid|insufficient funds|failed)\b/i.test(t);
  const debit = /\b(debited|spent|paid|withdrawn|sent|deducted|purchase|dr\b)/i.test(t);
  const credit = /\b(credited|received|deposited|refund(?:ed)?|cr\b)/i.test(t);

  if (isEmi && bounced) out.kind = 'emi_bounce';
  else if (isEmi && debit) out.kind = 'emi_debit';
  else if (debit && /credit card|\bcard\b.*\bspent\b|\bspent\b.*\bcard\b/i.test(t)) out.kind = 'card_spend';
  else if (debit && !credit) out.kind = 'debit';
  else if (credit && !debit) out.kind = 'credit';
  else if (debit && credit) {
    // "debited … and credited to X": the user's side is the first verb.
    out.kind = t.search(/debited|spent|paid|sent/i) < t.search(/credited|received/i) ? 'debit' : 'credit';
  }

  const m = t.match(/\b(?:at|to|towards|for|info[:\s])\s*([A-Za-z0-9][A-Za-z0-9 &.'@\-_*/]{1,40}?)(?=\s+(?:on|via|ref|upi|avl|avail|txn|\(|from)\b|[.;]\s|\s*$)/i);
  out.merchant = cleanMerchant(m ? m[1] : null);
  if (out.kind === 'credit') out.merchant = cleanMerchant(after(/\bfrom\s+([A-Za-z0-9][A-Za-z0-9 &.'@\-_]{1,40}?)(?=\s+(?:on|via|ref|upi|avl)\b|[.;]\s|\s*$)/i, t)) ?? out.merchant;
  return out;
}

/** Split a pasted block into messages: one per blank-line-separated block, or
 *  one per line when each line is a whole message. */
export function splitMessages(block: string): string[] {
  const parts = block.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  if (parts.length > 1) return parts;
  const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
  const each = lines.length > 1 && lines.every((l) => AMT_RE.test(l) || /\botp\b/i.test(l));
  return each ? lines : parts;
}

export function parseSmsBatch(block: string, max = 200): ParsedSms[] {
  return splitMessages(block).slice(0, max).map(parseSms);
}

export interface LoanForMatch {
  id: string;
  bank?: string;
  scheduled_emi?: string;
  account_last4?: string;
}

/** Which of the user's loans an EMI debit is for: same last digits, or the
 *  same EMI within ₹2 (EMIs are rounded to the rupee) at a matching lender.
 *  Returns the loan id only when exactly one loan fits. */
export function matchEmiToLoan(sms: ParsedSms, loans: LoanForMatch[]): string | null {
  if (sms.kind !== 'emi_debit' || !sms.amount) return null;
  const amt = Number(sms.amount);
  if (sms.account_last4) {
    const byDigits = loans.filter((l) => l.account_last4 && l.account_last4 === sms.account_last4);
    if (byDigits.length === 1) return byDigits[0].id;
  }
  const near = loans.filter((l) => l.scheduled_emi && Math.abs(Number(l.scheduled_emi) - amt) <= 2);
  if (near.length === 1) return near[0].id;
  if (near.length > 1 && sms.bank) {
    const key = sms.bank.split(' ')[0].toLowerCase();
    const sameBank = near.filter((l) => (l.bank ?? '').toLowerCase().includes(key));
    if (sameBank.length === 1) return sameBank[0].id;
  }
  return null;
}

/** Sum of card spends per card in a batch: a real "new spend" figure. */
export function cardSpendByCard(list: ParsedSms[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of list) {
    if (s.kind !== 'card_spend' || !s.amount) continue;
    const k = s.card_last4 ?? 'unknown';
    out[k] = Math.round(((out[k] ?? 0) + Number(s.amount)) * 100) / 100;
  }
  return out;
}
