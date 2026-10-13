/**
 * The inputs a loan needs before the plan can project it.
 *
 * Setup used to let a balance through with a blank rate or EMI, and the
 * blanks became 0: a ₹1 lakh card read as a 0% loan (so home said to
 * invest instead of paying it), and a home loan with no EMI was never
 * paid down. Setup now asks for them; pages use this to say "add these"
 * instead of projecting from a profile saved before that.
 */
import { LOAN_TYPE_NAME } from './loan-types';
import type { Country, LoanPayload, LoanType, UserPayload } from './api';
import { dec } from './safe-decimal';
import { loanToUser } from './currency';
import { paymentWords } from './r7-inputs';
import { amountInWords, formatAmount } from './amount';

/** 'fx': a loan in another currency with no exchange rate on file. Without
 *  one, ₹20 lakh read as $20 lakh (a $14,000 monthly shortfall). */
export type LoanGapField = 'rate' | 'emi' | 'fx';

/** Where the user lives and the rates saved in their profile, to check a
 *  foreign-currency loan has one. */
export interface GapContext {
  country: Country;
  fx?: Record<string, string>;
}

/** Loan types that are never interest-free, so a 0% rate means it's
 *  missing. Personal loans, BNPL and car loans can be 0% ("no-cost EMI",
 *  dealer offers), so an entered 0 stands for those. */
const NEVER_ZERO_RATE: ReadonlySet<LoanType> = new Set([
  'credit_card',
  'home_loan',
  'education_loan',
  'gold_loan',
]);

/** Cards revolve: the bank sets the minimum, so no EMI is needed. */
export function needsEmi(type: LoanType): boolean {
  return type !== 'credit_card';
}

/** A stored rate (a fraction of 1) the plan engine won't take: not a
 *  number, negative, or above 100% a year (the API's bounds), with what to
 *  tell the user. Setup used to save −5% and 500%, and the plan then said
 *  "unreachable right now" instead of pointing at the rate. */
export function rateOutOfRange(rate: string | null | undefined): string | null {
  const t = (rate ?? '').trim();
  if (t === '') return null;
  const n = Number(t);
  if (!Number.isFinite(n)) return 'Enter the rate as a number, e.g. 8.5 for 8.5% a year.';
  if (n < 0) return 'A rate can’t be negative. Enter the rate from your statement, e.g. 8.5.';
  if (n > 1) {
    return 'Rates above 100% a year aren’t accepted. Enter the yearly rate as a percent: 36 for 36% (a 3% monthly rate is 36% a year).';
  }
  return null;
}

/** The same check for a rate typed as a percent ("8.5" for 8.5%). */
export function percentRateError(pct: string): string | null {
  const t = pct.trim();
  if (t === '') return null;
  const n = Number(t);
  if (!Number.isFinite(n)) return rateOutOfRange(t);
  return rateOutOfRange(String(n / 100));
}

/** What this loan is missing, for a saved loan (blanks already stored as 0).
 *  Pass `ctx` to also check a foreign-currency loan has an exchange rate. */
export function loanGaps(loan: LoanPayload, ctx?: GapContext): LoanGapField[] {
  const gaps: LoanGapField[] = [];
  if (
    rateOutOfRange(loan.nominal_rate) ||
    (NEVER_ZERO_RATE.has(loan.loan_type) && dec(loan.nominal_rate).lte(0))
  ) {
    gaps.push('rate');
  }
  if (needsEmi(loan.loan_type) && dec(loan.scheduled_emi).lte(0)) gaps.push('emi');
  if (ctx && loanToUser(1, loan, ctx.country, ctx.fx) == null) gaps.push('fx');
  return gaps;
}

/** Setup's check on a loan being typed in: a blank field is missing even
 *  where 0 would be allowed. Returns a message per missing field. */
export function loanDraftErrors(
  loan: Pick<LoanPayload, 'loan_type' | 'nominal_rate' | 'scheduled_emi' | 'outstanding'> & { currency?: 'INR' | 'USD' },
  country?: string,
): Partial<Record<LoanGapField, string>> {
  const pw = paymentWords(country ?? (loan.currency === 'USD' ? 'US' : 'IN'));
  // A typed rate the engine won't take is an error even on a row with no
  // balance: the whole profile goes to the engine.
  const badRate = rateOutOfRange(loan.nominal_rate);
  if (badRate) return { rate: badRate };
  if (dec(loan.outstanding).lte(0)) return {};
  const out: Partial<Record<LoanGapField, string>> = {};
  const rateBlank = (loan.nominal_rate ?? '').trim() === '';
  if (loan.loan_type === 'credit_card' && (rateBlank || dec(loan.nominal_rate).lte(0))) {
    out.rate = 'Enter the card’s interest rate, e.g. 42 (a 3.5% monthly rate is 42% a year).';
  } else if (rateBlank) {
    out.rate = 'Enter the interest rate from your statement (0 only if it’s really interest-free).';
  } else if (NEVER_ZERO_RATE.has(loan.loan_type) && dec(loan.nominal_rate).lte(0)) {
    out.rate = 'This kind of loan always charges interest. Enter the rate from your statement.';
  }
  if (needsEmi(loan.loan_type) && dec(loan.scheduled_emi).lte(0)) {
    out.emi = pw.one === 'EMI'
      ? 'Enter the monthly EMI the bank takes (on your statement or banking app).'
      : 'Enter the monthly payment the lender takes (on your statement or banking app).';
  } else if (needsEmi(loan.loan_type) && !out.rate) {
    const never = emiBelowInterest(loan, country);
    if (never) out.emi = never;
  }
  return out;
}

/**
 * A loan whose EMI is at or below the interest it earns each month never
 * clears: the plan used to run it for 1,200 months and print 25-digit
 * figures (live re-test NEW-3). Returns the message naming the numbers,
 * with "did you mean ₹25 lakh?" when a balance a tenth the size would
 * clear at this EMI (an extra 0 typed, NEW-4). Null when it amortises.
 */
export function emiBelowInterest(
  loan: Pick<LoanPayload, 'loan_type' | 'nominal_rate' | 'scheduled_emi' | 'outstanding'> & { currency?: 'INR' | 'USD' },
  country?: string,
): string | null {
  if (!needsEmi(loan.loan_type)) return null;
  const P = dec(loan.outstanding);
  const rate = dec(loan.nominal_rate);
  const E = dec(loan.scheduled_emi);
  if (P.lte(0) || rate.lte(0) || E.lte(0)) return null;
  const interest = P.mul(rate).div(12);
  if (E.gt(interest)) return null;
  const ccy = loan.currency === 'USD' ? 'USD' : 'INR';
  const sym = ccy === 'INR' ? '₹' : '$';
  const money = (d: typeof P) => `${sym}${formatAmount(d.toDecimalPlaces(0).toFixed(), ccy)}`;
  // R8-1: "₹25 lakh" reads well in India; in dollars a word only helps from
  // a million up ("$18 thousand" is not how a US statement reads).
  const words = (d: typeof P) =>
    ccy === 'USD' && d.lt(1_000_000) ? money(d) : (amountInWords(d.toDecimalPlaces(0).toFixed(), ccy) ?? money(d));
  const pw = paymentWords(country ?? (ccy === 'USD' ? 'US' : 'IN'));
  const pct = rate.mul(100).toDecimalPlaces(2).toString();
  const tenth = P.div(10);
  const guess = E.gt(tenth.mul(rate).div(12)) ? ` (did you mean ${words(tenth)}?)` : '';
  return (
    `At ${pct}%, ${words(P)} earns ${money(interest)} interest a month, ` +
    `${E.eq(interest.toDecimalPlaces(0)) || E.eq(interest) ? 'the same as' : 'more than'} the ${money(E)} ${pw.one}, so this loan would never be paid off. ` +
    `Check the balance${guess}, the rate and the ${pw.one}.`
  );
}

export interface ProfileGap {
  /** Position in user.loans. */
  index: number;
  loan: LoanPayload;
  missing: LoanGapField[];
}

/** Open loans the plan can't project yet. */
export function projectionGaps(
  user: Pick<UserPayload, 'loans' | 'country' | 'fx_to_user_currency'>,
): ProfileGap[] {
  const ctx = { country: user.country, fx: user.fx_to_user_currency };
  return (user.loans ?? [])
    .map((loan, index) => ({ index, loan, missing: loanGaps(loan, ctx) }))
    .filter((g) => dec(g.loan.outstanding).gt(0) && g.missing.length > 0);
}

const GAP_WORDS: Record<LoanGapField, string> = {
  rate: 'interest rate',
  emi: 'EMI',
  fx: 'exchange rate',
};

/** "the interest rate and EMI" / "the exchange rate". Pass the loan to
 *  name a stored rate the engine won't take: "a valid interest rate (500%
 *  isn't accepted)". */
export function describeGap(
  missing: LoanGapField[],
  loan?: Pick<LoanPayload, 'nominal_rate'>,
): string {
  if (loan && missing.includes('rate') && rateOutOfRange(loan.nominal_rate)) {
    const n = Number(loan.nominal_rate);
    const rate = Number.isFinite(n)
      ? `a valid interest rate (${Number((n * 100).toFixed(2))}% isn’t accepted)`
      : 'a valid interest rate';
    const rest = missing.filter((f) => f !== 'rate').map((f) => GAP_WORDS[f]);
    return rest.length ? `${rate} and the ${rest.join(' and ')}` : rate;
  }
  const words = missing.map((f) => GAP_WORDS[f]);
  return `the ${words.join(' and ')}`;
}

/** Live re-test 2 R2-2: Setup's line above Continue, naming what's wrong.
 *  Live re-test 3 R3-4: a rate that can't be read ("8.5x") or is out of
 *  range is `invalid`, never "missing a number"; `missing` is blank fields. */
/** "2026-10-10" → "10 Oct 2026", as the rest of the app writes dates (UX50 B-36). */
export function formatAsOfDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '');
  if (!m) return iso;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const mi = Number(m[2]) - 1;
  if (mi < 0 || mi > 11) return iso;
  return `${Number(m[3])} ${months[mi]} ${m[1]}`;
}

export function setupSummaryLine(f: {
  emiTooSmall: boolean;
  missing: boolean;
  fx: boolean;
  invalid?: boolean;
  /** Live re-test 6B R6B-7: the bad rate is a number, just out of range
   *  (−42, 4200): say "out of range", not "isn't a valid number". */
  outOfRange?: boolean;
  /** How many loans have an unanswered "has this month's EMI gone out?" (UX50 B-36). */
  unanswered?: number;
  monthName?: string;
}): string {
  const asked = f.unanswered ?? 0;
  if (asked > 0 && !f.emiTooSmall && !f.invalid && !f.missing) {
    const month = f.monthName ? `${f.monthName}’s` : 'this month’s';
    return asked === 1
      ? `One loan needs an answer: whether ${month} EMI has gone out. It’s marked above.`
      : `${asked} loans need an answer: whether ${month} EMI has gone out. They’re marked above.`;
  }
  const problems = [
    f.emiTooSmall ? 'one EMI is too small to pay it off' : '',
    f.invalid ? (f.outOfRange ? 'one rate is out of range' : 'one rate isn’t a valid number') : '',
    f.missing ? 'some are missing a number' : '',
  ].filter(Boolean);
  if (f.emiTooSmall && !f.invalid && !f.missing) return 'A loan needs a fix: its EMI is too small to pay it off. It’s marked above.';
  if (f.invalid && !f.emiTooSmall && !f.missing)
    return f.outOfRange
      ? 'A loan needs a fix: its rate is out of range (0 to 100% a year). It’s marked above.'
      : 'A loan needs a fix: its rate isn’t a valid number. It’s marked above.';
  if (f.missing && !f.emiTooSmall && !f.invalid) return 'Some loans are missing a number. They’re marked above.';
  if (problems.length > 1) {
    const list = problems.length === 2 ? problems.join(', and ') : `${problems.slice(0, -1).join(', ')}, and ${problems.at(-1)}`;
    return `Some loans need a fix: ${list}. They’re marked above.`;
  }
  if (f.fx) return 'Check the exchange rate marked above.';
  return 'Something above needs a fix. It’s marked above.';
}

/** Live re-test 2 NEW-23: a Setup loan's header by its lender and type
 *  ("HDFC Bank car loan", "Credit card"), numbered only when two read the
 *  same ("Personal loan 2"). The lender's own capitals are kept. */
export function setupLoanName(
  loans: Array<{ loan_type: keyof typeof LOAN_TYPE_NAME; bank?: string | null }>,
  i: number,
): string {
  const base = (l: { loan_type: keyof typeof LOAN_TYPE_NAME; bank?: string | null }) => {
    const type = LOAN_TYPE_NAME[l.loan_type] ?? 'loan';
    const bank = (l.bank ?? '').trim();
    return bank ? `${bank} ${type}` : type.charAt(0).toUpperCase() + type.slice(1);
  };
  const me = base(loans[i]);
  const same = loans.map(base).filter((n) => n === me).length;
  if (same < 2) return me;
  const nth = loans.slice(0, i + 1).map(base).filter((n) => n === me).length;
  return `${me} ${nth}`;
}
