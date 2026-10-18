/**
 * What Home's retention pieces need from the plan (Audit 80, W5):
 * - the advice check (A8): open loans as numbers, and which one this month's
 *   extra goes to (the plan's own pick, from "Pay this month");
 * - the rate-move email (A13): floating-rate rupee loans it can watch, with
 *   a first guess at "repo-linked": a bank's floating home/car/education/LAP
 *   loan, since RBI makes banks link those to an external benchmark
 *   (citations.EBLR_MANDATE; HFCs and NBFCs aren't bound, citations.EBLR_SCOPE).
 */
import type { LoanPayload } from './api';
import type { PayThisMonth } from './pay-this-month';
import type { AdviceLoan } from './advice-check';
import type { RateWatchLoan } from '@/components/retention/RateMoveEmail';
import { LOAN_TYPE_NAME } from './loan-types';

const REPO_KINDS = new Set(['home_loan', 'auto_loan', 'education_loan']);
const BANKS = new Set(['bank', 'small_finance_bank', undefined]);

const num = (v: string | number | undefined | null) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export function retentionInputs(loans: LoanPayload[], pay: PayThisMonth, country: string): {
  adviceLoans: AdviceLoan[]; extraTarget: number | null; rateLoans: RateWatchLoan[];
} {
  const open = loans.map((l, i) => ({ l, i })).filter(({ l }) => num(l.outstanding) > 0);
  const adviceLoans: AdviceLoan[] = open.map(({ l }) => ({
    loan_type: l.loan_type,
    outstanding: num(l.outstanding),
    rate: l.nominal_rate !== undefined && l.nominal_rate !== '' ? num(l.nominal_rate) : null,
    emi: num(l.scheduled_emi) > 0 ? num(l.scheduled_emi) : null,
    months_left: l.tenure_months_remaining > 0 ? l.tenure_months_remaining : null,
    rate_type: l.rate_type === 'fixed' ? 'fixed' : 'floating',
    bank: (l.bank || '').slice(0, 40),
  }));
  const extraRow = pay.rows.find((r) => r.loanIndex !== null && (r.kind === 'extra' || r.kind === 'clears'));
  const target = extraRow ? open.findIndex(({ i }) => i === extraRow.loanIndex) : -1;
  const userCcy = country === 'US' ? 'USD' : 'INR';
  const rateLoans: RateWatchLoan[] = country === 'IN'
    ? open
        .filter(({ l }) => l.rate_type === 'floating' && (l.currency ?? userCcy) === 'INR' && l.loan_type !== 'credit_card'
          && l.loan_type !== 'bnpl' && num(l.nominal_rate) > 0)
        .map(({ l }) => ({
          name: `${l.bank ? `${l.bank} ` : ''}${LOAN_TYPE_NAME[l.loan_type] ?? 'loan'}`.slice(0, 60),
          outstanding: num(l.outstanding),
          rate: num(l.nominal_rate),
          emi: num(l.scheduled_emi) > 0 ? num(l.scheduled_emi) : null,
          monthsLeft: l.tenure_months_remaining > 0 ? l.tenure_months_remaining : null,
          likelyRepo: REPO_KINDS.has(l.loan_type) && BANKS.has(l.lender_type),
        }))
    : [];
  return { adviceLoans, extraTarget: target >= 0 ? target : null, rateLoans };
}
