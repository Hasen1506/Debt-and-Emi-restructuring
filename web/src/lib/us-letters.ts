/**
 * US letters page (/cant-pay/us-letters, round 2, 15 Oct 2026): fill the
 * placeholders of the letters /api/complaints/us returns, in the browser.
 *
 * The API (engine/complaints_us.py) never sees a name, account number or
 * address: it returns "[Full name]", "[Account number]" and so on, and this
 * swaps in what the borrower typed. A blank field keeps its bracket so the
 * gap is obvious before sending. The tokens below must match the engine's
 * constants exactly; web/tests/r2-web-us-letters.cjs reads
 * engine/complaints_us.py and fails if one drifts.
 */
import type { UsComplaintKind } from './api';

/** Engine placeholder → which field fills it. */
export const US_TOKENS = {
  name: '[Full name]',
  account: '[Account number]',
  address: '[Your mailing address]',
  issuer: '[Card issuer]',
  servicer: '[Mortgage servicer]',
  errorAddress: '[Billing-error address from your statement]',
  noeAddress: "[Servicer's notice-of-error address, if it designated one]",
  statementDate: '[Statement date]',
  txnDate: '[Transaction date]',
  amount: '[Disputed amount, US$]',
  description: '[What the charge says on the statement]',
  why: '[Why it is wrong: not authorised / not delivered / paid but not credited / wrong amount]',
  loanError: '[The error: e.g. payment not credited on [date], wrong escrow charge, late fee charged in error]',
} as const;

export type UsField = keyof typeof US_TOKENS;

export type UsLetterValues = Partial<Record<UsField, string>>;

/** The fields each letter asks for, in the order shown, with plain labels. */
export const US_FIELDS: Record<UsComplaintKind, Array<{ key: UsField; label: string; placeholder?: string; multiline?: boolean }>> = {
  fcba_billing_error: [
    { key: 'name', label: 'Your full name' },
    { key: 'account', label: 'Card account number' },
    { key: 'address', label: 'Your mailing address', multiline: true },
    { key: 'issuer', label: 'Card issuer', placeholder: 'e.g. Chase' },
    { key: 'errorAddress', label: 'Billing-error address (from your statement)', multiline: true },
    { key: 'statementDate', label: 'Statement date', placeholder: 'e.g. 3 October 2026' },
    { key: 'txnDate', label: 'Transaction date' },
    { key: 'amount', label: 'Disputed amount (US$)' },
    { key: 'description', label: 'What the charge says on the statement' },
    { key: 'why', label: 'Why it is wrong', placeholder: 'not authorised / not delivered / paid but not credited / wrong amount' },
  ],
  respa_notice_of_error: [
    { key: 'name', label: 'Your full name' },
    { key: 'account', label: 'Mortgage loan number' },
    { key: 'address', label: 'Property address', multiline: true },
    { key: 'servicer', label: 'Mortgage servicer', placeholder: 'e.g. Mr. Cooper' },
    { key: 'noeAddress', label: "Servicer's notice-of-error address (if it gave one)", multiline: true },
    { key: 'loanError', label: 'The error', placeholder: 'e.g. my 1 October payment was not credited', multiline: true },
  ],
};

export const US_LETTER_TITLES: Record<UsComplaintKind | 'hardship', string> = {
  hardship: 'Hardship request',
  fcba_billing_error: 'Card billing dispute (FCBA)',
  respa_notice_of_error: 'Mortgage notice of error (RESPA)',
};

/**
 * Fill every known token. Longer tokens first, so "[The error: … [date] …]"
 * is replaced whole before any shorter token could match inside it.
 */
export function fillUsLetter(text: string, values: UsLetterValues): string {
  const pairs = (Object.keys(US_TOKENS) as UsField[])
    .map((k) => [US_TOKENS[k], (values[k] ?? '').trim()] as const)
    .sort((a, b) => b[0].length - a[0].length);
  let out = text;
  for (const [token, v] of pairs) {
    if (v) out = out.split(token).join(v);
  }
  return out;
}

/** Brackets still in the letter, as plain words for a "Still needed" line. */
export function usMissing(kind: UsComplaintKind, values: UsLetterValues): string[] {
  const must: UsField[] = kind === 'fcba_billing_error'
    ? ['name', 'account', 'issuer', 'errorAddress', 'amount', 'why']
    : ['name', 'account', 'servicer', 'loanError'];
  const labels = Object.fromEntries(US_FIELDS[kind].map((f) => [f.key, f.label.toLowerCase()]));
  return must.filter((k) => !(values[k] ?? '').trim()).map((k) => labels[k] ?? k);
}

/** Who sees the US letters link (More → Help, /cant-pay): US users, or anyone who picked the USA on /cant-pay. */
export const US_LETTERS_PATH = '/cant-pay/us-letters';
