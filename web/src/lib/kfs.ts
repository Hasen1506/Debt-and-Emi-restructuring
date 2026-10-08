/**
 * Import a loan from its Key Facts Statement or sanction letter (roadmap PR G).
 *
 * The API (POST /api/kfs/read, engine/kfs.py) reads the document and returns
 * each value with the line it came from, the EMI / APR cross-checks and the
 * loan it would fill in. Nothing is saved there. This file turns that reply
 * into the review form (every field editable, each marked "from your KFS",
 * "worked out from your KFS" or "you entered") and, when the user confirms,
 * into a loan for the Profile form, which they still save themselves.
 *
 * RBI circular RBI/2024-25/18, DOR.STR.REC.13/13.03.00/2024-25, 15 Apr 2024:
 * every retail / MSME term loan sanctioned from 1 Oct 2024 comes with a KFS
 * in the standard format (Annex A), stating the rate, APR and every charge.
 */
import type { LoanPayload, LoanType } from './api';

export const KFS_CIRCULAR = 'RBI circular RBI/2024-25/18, 15 Apr 2024';
export const KFS_CIRCULAR_URL = 'https://www.rbi.org.in/Scripts/NotificationUser.aspx?Id=12663&Mode=0';

export interface KfsFound {
  value: string;
  source: string;
  note: string;
}

export interface KfsCheck {
  kind: 'emi' | 'apr' | 'spread';
  ok: boolean;
  stated: string | null;
  computed: string | null;
  message: string;
}

/** The loan fields the KFS can fill. Rates and fees are fractions. */
export type KfsLoanKey =
  | 'bank'
  | 'loan_type'
  | 'rate_type'
  | 'nominal_rate'
  | 'outstanding'
  | 'tenure_months_remaining'
  | 'scheduled_emi'
  | 'processing_fee_amortised'
  | 'prepayment_penalty_pct'
  | 'first_emi_month';

export interface KfsReadResponse {
  is_kfs: boolean;
  fields: Record<string, KfsFound>;
  checks: KfsCheck[];
  loan: Partial<Record<KfsLoanKey, string | null>>;
  derived: Partial<Record<KfsLoanKey, string>>;
  warnings: string[];
  circular: string;
  circular_url: string;
}

export type Provenance = 'kfs' | 'derived' | 'user';

export interface ReviewRow {
  key: KfsLoanKey;
  label: string;
  kind: 'text' | 'percent' | 'money' | 'integer' | 'month' | 'loan_type' | 'rate_type';
  value: string;
  provenance: Provenance;
  /** The document's line ("from your KFS") or how it was worked out. */
  source: string;
}

/** Which KFS field each loan field is read from. */
const SOURCE_FIELD: Record<KfsLoanKey, string[]> = {
  bank: ['lender'],
  loan_type: ['loan_type'],
  rate_type: ['rate_type'],
  nominal_rate: ['interest_rate'],
  outstanding: ['sanctioned_amount'],
  tenure_months_remaining: ['tenure_months', 'emi_count'],
  scheduled_emi: ['emi'],
  processing_fee_amortised: ['processing_fee'],
  prepayment_penalty_pct: ['prepayment_charge'],
  first_emi_month: ['first_emi_date'],
};

const ROWS: { key: KfsLoanKey; label: string; kind: ReviewRow['kind'] }[] = [
  { key: 'bank', label: 'Lender', kind: 'text' },
  { key: 'loan_type', label: 'Loan type', kind: 'loan_type' },
  { key: 'rate_type', label: 'Rate type', kind: 'rate_type' },
  { key: 'nominal_rate', label: 'Interest rate', kind: 'percent' },
  { key: 'outstanding', label: 'Outstanding balance', kind: 'money' },
  { key: 'tenure_months_remaining', label: 'Months left', kind: 'integer' },
  { key: 'scheduled_emi', label: 'EMI', kind: 'money' },
  { key: 'processing_fee_amortised', label: 'Processing fee a year', kind: 'percent' },
  { key: 'prepayment_penalty_pct', label: 'Prepayment fee', kind: 'percent' },
  { key: 'first_emi_month', label: 'First EMI (month)', kind: 'month' },
];

/** The review form's rows: every field the KFS can fill, read or not. */
export function reviewRows(res: KfsReadResponse): ReviewRow[] {
  return ROWS.map(({ key, label, kind }) => {
    const v = res.loan[key];
    const derived = res.derived[key];
    if (v == null || v === '') {
      return { key, label, kind, value: '', provenance: 'user', source: '' };
    }
    if (derived) return { key, label, kind, value: v, provenance: 'derived', source: derived };
    const f = SOURCE_FIELD[key].map((k) => res.fields[k]).find(Boolean);
    return {
      key,
      label,
      kind,
      value: v,
      provenance: 'kfs',
      source: f ? (f.note ? `${f.source} (${f.note})` : f.source) : '',
    };
  });
}

/** The user changed a field in the review: it is theirs now. */
export function editRow(rows: ReviewRow[], key: KfsLoanKey, value: string): ReviewRow[] {
  return rows.map((r) => (r.key === key ? { ...r, value, provenance: 'user' as const } : r));
}

export function provenanceLabel(p: Provenance): string {
  return p === 'kfs' ? 'from your KFS' : p === 'derived' ? 'worked out from your KFS' : 'you entered';
}

/** Today's month key on the user's clock, 'YYYY-MM'. */
function monthOf(isoDate: string): string {
  return isoDate.slice(0, 7);
}

/**
 * The loan to add to the Profile form, from the confirmed review. Fields
 * still holding the KFS's own values are listed in `kfs_fields`, so the
 * form can say where they came from; nothing is saved until the user saves
 * the Profile.
 */
export function loanFromReview(rows: ReviewRow[], base: LoanPayload, todayIso: string): LoanPayload {
  const get = (k: KfsLoanKey) => rows.find((r) => r.key === k)?.value ?? '';
  const loan: LoanPayload = { ...base };
  const lt = get('loan_type') as LoanType;
  if (lt) loan.loan_type = lt;
  if (get('bank')) loan.bank = get('bank');
  const rt = get('rate_type');
  if (rt === 'fixed' || rt === 'floating') {
    loan.rate_type = rt;
    loan.rate_type_assumed = false;
  }
  if (get('nominal_rate')) loan.nominal_rate = get('nominal_rate');
  if (get('outstanding')) loan.outstanding = get('outstanding');
  if (get('tenure_months_remaining')) loan.tenure_months_remaining = Number(get('tenure_months_remaining')) || 0;
  if (get('scheduled_emi')) loan.scheduled_emi = get('scheduled_emi');
  if (get('processing_fee_amortised')) loan.processing_fee_amortised = get('processing_fee_amortised');
  if (get('prepayment_penalty_pct') !== '') loan.prepayment_penalty_pct = get('prepayment_penalty_pct');
  const first = get('first_emi_month');
  if (first && first > monthOf(todayIso)) loan.first_emi_month = first;
  loan.balance_as_of = todayIso;
  loan.kfs_fields = rows.filter((r) => r.provenance !== 'user' && r.value !== '').map((r) => r.key);
  return loan;
}

/** Fields a Profile edit changes stop being "from your KFS". */
export function dropKfsFields(loan: LoanPayload, patch: Partial<LoanPayload>): string[] | undefined {
  if (!loan.kfs_fields?.length) return loan.kfs_fields;
  const changed = Object.keys(patch).filter(
    (k) => k !== 'kfs_fields' && (patch as Record<string, unknown>)[k] !== (loan as unknown as Record<string, unknown>)[k],
  );
  return loan.kfs_fields.filter((k) => !changed.includes(k));
}

const NAMES: Partial<Record<string, string>> = {
  bank: 'lender',
  loan_type: 'loan type',
  rate_type: 'rate type',
  nominal_rate: 'rate',
  outstanding: 'balance',
  tenure_months_remaining: 'months left',
  scheduled_emi: 'EMI',
  processing_fee_amortised: 'processing fee',
  prepayment_penalty_pct: 'prepayment fee',
  first_emi_month: 'first EMI',
};

/** "Rate, EMI and prepayment fee from your Key Facts Statement." */
export function kfsNote(loan: Pick<LoanPayload, 'kfs_fields'>): string | null {
  const names = (loan.kfs_fields ?? []).map((k) => NAMES[k]).filter(Boolean) as string[];
  if (!names.length) return null;
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  return `${list.charAt(0).toUpperCase()}${list.slice(1)} from your Key Facts Statement. Change any of them and it counts as yours.`;
}

/** base64 of a file's bytes, for the upload. */
export function bytesToBase64(bytes: Uint8Array): string {
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return typeof btoa === 'function' ? btoa(s) : Buffer.from(s, 'binary').toString('base64');
}
