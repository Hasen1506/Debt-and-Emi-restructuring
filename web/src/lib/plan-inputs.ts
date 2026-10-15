/**
 * Round 2 (founder, 15 Oct 2026): inputs the plan used to assume silently,
 * now visible and editable on Plan, with the assumption labelled.
 *  - item 2: the gap-borrowing limit (engine C11 default: 3 months of take-home)
 *  - item 1: how each floating loan takes a rate rise (extend / raise EMI / mix),
 *    the lender's maximum tenure, the date of birth and retirement age
 *    (engine/contract.py extension_cap: min(360, lender max, age limit))
 *  - item 3: the user's own assumed return after tax (default 6.5% IN / 4% US),
 *    which decides when the prepay / keep / split question is asked
 * Pure helpers (no React), so they are unit-tested in tests/r2-plan-inputs.cjs.
 */
import type { LoanPayload, UserPayload } from './api';

export const GAP_LIMIT_MONTHS = 3;
export const DEFAULT_ASSUMED_RETURN: Record<'IN' | 'US', string> = { IN: '0.065', US: '0.04' };
export const SPLIT_MARGIN = 0.01;
export const DEFAULT_RETIREMENT_AGE = { salaried: 60, other: 70 } as const;
export const MAX_EXTENSION_MONTHS = 360;
export type RateRiseMode = 'extend' | 'raise_emi' | 'mix';

/** The limit the plan uses: the user's own, else 3 months of take-home. */
export function gapLimitFor(user: Pick<UserPayload, 'gap_credit_limit' | 'monthly_income'>): { value: number; assumed: boolean } {
  const own = normalizeAmount(user.gap_credit_limit);
  if (own !== '') return { value: Number(own), assumed: false };
  return { value: Math.round(Number(user.monthly_income || 0) * GAP_LIMIT_MONTHS), assumed: true };
}

/** '' for blank (use the assumption); a non-negative whole amount otherwise; null if invalid. */
export function normalizeAmount(v: string | number | null | undefined): string {
  const t = String(v ?? '').replace(/[,\s₹$]/g, '').trim();
  if (t === '') return '';
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 && n <= 1e12 ? String(Math.round(n)) : '';
}

export function parseAmount(v: string): string | null {
  const t = v.replace(/[,\s₹$]/g, '').trim();
  if (t === '') return '';
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 && n <= 1e12 ? String(Math.round(n)) : null;
}

/** A yearly % typed by the user ("7.5") → decimal text ("0.075"), 0–30%; '' blank; null invalid. */
export function parseReturnPct(v: string): string | null {
  const t = v.replace('%', '').trim();
  if (t === '') return '';
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 && n <= 30 ? String(Number((n / 100).toFixed(4))) : null;
}

export function assumedReturnFor(user: Pick<UserPayload, 'assumed_post_tax_return' | 'country'>): { value: number; assumed: boolean } {
  const own = user.assumed_post_tax_return;
  if (own != null && own !== '' && Number.isFinite(Number(own))) return { value: Number(own), assumed: false };
  return { value: Number(DEFAULT_ASSUMED_RETURN[user.country === 'US' ? 'US' : 'IN']), assumed: true };
}

/** The after-tax cost below which a loan gets the prepay / keep / split question. */
export function splitThreshold(user: Pick<UserPayload, 'assumed_post_tax_return' | 'country'>): number {
  return assumedReturnFor(user).value + SPLIT_MARGIN;
}

/** YYYY-MM or YYYY-MM-DD, a real past month after 1900; '' blank; null invalid. */
export function parseDob(v: string, todayIso: string): string | null {
  const t = v.trim();
  if (t === '') return '';
  const m = /^(19|20)\d\d-(0[1-9]|1[0-2])(-(0[1-9]|[12]\d|3[01]))?$/.exec(t);
  if (!m) return null;
  return t.slice(0, 7) <= todayIso.slice(0, 7) ? t : null;
}

export function parseRetirementAge(v: string): number | '' | null {
  const t = v.trim();
  if (t === '') return '';
  const n = Number(t);
  return Number.isInteger(n) && n >= 40 && n <= 85 ? n : null;
}

export function retirementAgeFor(user: Pick<UserPayload, 'retirement_age' | 'income_type'>): { value: number; assumed: boolean } {
  if (user.retirement_age) return { value: user.retirement_age, assumed: false };
  return { value: user.income_type === 'salaried' ? DEFAULT_RETIREMENT_AGE.salaried : DEFAULT_RETIREMENT_AGE.other, assumed: true };
}

/** Months until the age limit, from this month; null without a date of birth. */
export function monthsToAgeLimit(user: Pick<UserPayload, 'date_of_birth' | 'retirement_age' | 'income_type'>, todayIso: string): number | null {
  if (!user.date_of_birth) return null;
  const [y, m] = user.date_of_birth.split('-').map(Number);
  const [ty, tm] = todayIso.split('-').map(Number);
  const age = (ty - y) * 12 + (tm - m);
  return retirementAgeFor(user).value * 12 - age;
}

export function parseMaxTenure(v: string): number | '' | null {
  const t = v.trim();
  if (t === '') return '';
  const n = Number(t);
  return Number.isInteger(n) && n >= 1 && n <= 480 ? n : null;
}

/** The market default when the loan doesn't say: tenure first for an Indian
 *  loan (founder decision, C1), a higher EMI for a US one. */
export function rateRiseModeFor(loan: Pick<LoanPayload, 'on_rate_rise' | 'currency'>, country: string): { mode: RateRiseMode; assumed: boolean } {
  if (loan.on_rate_rise) return { mode: loan.on_rate_rise, assumed: false };
  const market = loan.currency === 'INR' ? 'IN' : loan.currency === 'USD' ? 'US' : country;
  return { mode: market === 'IN' ? 'extend' : 'raise_emi', assumed: true };
}

/** Floating-rate loans only: fixed-rate loans (most personal and car loans)
 *  never reset, so the choice doesn't apply to them. */
export function floatingLoanIndices(loans: LoanPayload[]): number[] {
  return loans.map((l, i) => (l.rate_type === 'floating' && Number(l.outstanding || 0) > 0 ? i : -1)).filter((i) => i >= 0);
}

/** The extension ceiling the engine applies, in plain words. */
export function ceilingLine(loan: Pick<LoanPayload, 'loan_type' | 'max_tenure_months'>, ageMonths: number | null, country: string): string {
  const parts: string[] = [`${MAX_EXTENSION_MONTHS} months`];
  if (loan.max_tenure_months) parts.push(`your lender's ${loan.max_tenure_months} months`);
  else if (!(loan.loan_type === 'home_loan' && country === 'IN')) return "Not stretched past its end date unless you give your lender's maximum tenure; the EMI rises instead.";
  if (ageMonths != null) parts.push(ageMonths > 0 ? `${ageMonths} months to your age limit` : 'your age limit (already reached)');
  return `Stretched up to the smallest of ${parts.join(', ')}; past that the EMI rises.`;
}

/** Profile fields only Plan edits (round 2): a form that rebuilds the user
 *  from its own fields (Profile, Setup) must hand these back unchanged. */
export const PLAN_INPUT_USER_KEYS = [
  'gap_credit_limit', 'date_of_birth', 'retirement_age', 'assumed_post_tax_return', 'remittance_cost',
  'seasonal_income',
] as const;
export const PLAN_INPUT_LOAN_KEYS = ['on_rate_rise', 'max_tenure_months'] as const;

/** `built` with every Plan-only input the saved profile had and `built`
 *  doesn't mention. A key present on `built` (even set to undefined) is the
 *  form's own decision and wins; loans are matched by id. */
export function carryPlanInputs<U extends UserPayload>(built: U, prev: UserPayload | null | undefined): U {
  if (!prev) return built;
  const out: U = { ...built };
  const rec = out as unknown as Record<string, unknown>;
  const was = prev as unknown as Record<string, unknown>;
  for (const k of PLAN_INPUT_USER_KEYS) {
    if (!(k in rec) && was[k] !== undefined && was[k] !== null && was[k] !== '') rec[k] = was[k];
  }
  const byId = new Map((prev.loans ?? []).filter((l) => l.id).map((l) => [l.id as string, l]));
  out.loans = (built.loans ?? []).map((l) => {
    const old = l.id ? byId.get(l.id) : undefined;
    if (!old) return l;
    const n = { ...l } as unknown as Record<string, unknown>;
    const o = old as unknown as Record<string, unknown>;
    for (const k of PLAN_INPUT_LOAN_KEYS) if (!(k in n) && o[k] !== undefined && o[k] !== null) n[k] = o[k];
    return n as unknown as LoanPayload;
  });
  return out;
}

/** The three answers RBI's reset rule allows (circular of 18 Aug 2023). */
export const RATE_RISE_LABEL: Record<RateRiseMode, string> = {
  extend: 'Keep the EMI, extend the tenure',
  raise_emi: 'Raise the EMI, keep the end date',
  mix: 'Half and half',
};

/** Setup's compact choice for one floating loan: the market default first
 *  (labelled), then the three answers. '' = the default. */
export function rateRiseOptions(loan: Pick<LoanPayload, 'currency'>, country: string): { value: '' | RateRiseMode; label: string }[] {
  const def = rateRiseModeFor({ currency: loan.currency }, country).mode;
  return [
    { value: '', label: `Usual for this loan: ${RATE_RISE_LABEL[def].toLowerCase()}` },
    ...(['extend', 'raise_emi', 'mix'] as RateRiseMode[]).map((m) => ({ value: m, label: RATE_RISE_LABEL[m] })),
  ];
}

/** Plain words for the prepay / keep / split line: the threshold is the
 *  user's own assumed return after tax (or the labelled default) + 1 point,
 *  and it can be changed. Fractions as text ("0.075"). */
export function thresholdWords(threshold: string | number, assumedReturn: string | number | null | undefined, isDefault: boolean | undefined): string {
  const pctTxt = (v: string | number) => `${+(Number(v) * 100).toFixed(1)}%`;
  const ret = assumedReturn != null && assumedReturn !== '' ? Number(assumedReturn) : Number(threshold) - SPLIT_MARGIN;
  const whose = isDefault === false ? 'your own' : 'the assumed';
  return `${pctTxt(threshold)} a year after tax (${whose} ${pctTxt(ret)} return after tax plus ${SPLIT_MARGIN * 100} point; change it on Plan under “Your return after tax”)`;
}

/** A fraction as a % number for an input box ("0.065" → "6.5"), 1 decimal. */
export function pctInput(v: string | number): string {
  return (Number(v) * 100).toFixed(1);
}
