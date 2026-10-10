/**
 * Where a borrower finds each number the app asks for (X5).
 *
 * Every loan field has a paper source: the Key Facts Statement (KFS) a
 * lender in India must hand over before signing (RBI, 15 Apr 2024), the
 * sanction letter, the loan statement or interest certificate, the card
 * statement; in the US the Closing Disclosure, the Truth in Lending box,
 * the monthly mortgage or card statement. The forms show this under the
 * field as "Find it: …" so a figure can be copied, not guessed.
 */
import type { LoanType } from '@/lib/api';

export type FindKey =
  | 'balance'
  | 'rate'
  | 'rateType'
  | 'rateBasis'
  | 'resetFrequency'
  | 'nextReset'
  | 'emi'
  | 'monthsLeft'
  | 'prepayFee'
  | 'lockIn'
  | 'processingFee'
  | 'insurance'
  | 'statementDay'
  | 'dueDay'
  | 'cardMinimum'
  | 'creditScore'
  | 'takeHome'
  | 'taxRate'
  | 'loanStart'
  | 'startRate'
  | 'spread'
  | 'savingsRate'
  | 'offerFee'
  | 'offerRate'
  | 'taxableIncome'
  | 'purchasePrice';

type Ctx = { country: string; loanType?: LoanType | string };

const isCard = (t?: string) => t === 'credit_card';
const isMortgage = (t?: string) => t === 'home_loan' || t === 'lap';

function india(key: FindKey, t?: string): string | null {
  if (isCard(t)) {
    switch (key) {
      case 'balance':
        return 'card statement, "Total amount due"';
      case 'rate':
        return 'card statement or MITC, "Finance charges" (a monthly rate: × 12)';
      case 'statementDay':
        return 'card statement, "Statement date"';
      case 'dueDay':
        return 'card statement, "Payment due date"';
      case 'cardMinimum':
        return 'card statement, "Minimum amount due"';
      case 'emi':
        return 'what left your account for the card last month';
    }
  }
  switch (key) {
    case 'balance':
      return 'loan statement or the bank app, "Principal outstanding"';
    case 'rate':
      return 'latest loan statement; at signing, KFS "Rate of interest"';
    case 'rateType':
      return 'KFS, "Rate of interest and type"';
    case 'rateBasis':
      return 'KFS, "Reference benchmark" (repo / EBLR, MCLR, base rate)';
    case 'resetFrequency':
      return 'KFS, "Reset periodicity", or the sanction letter';
    case 'nextReset':
      return 'loan statement or the bank app; KFS gives the reset gap';
    case 'emi':
      return 'KFS, "Amount of instalments", or the debit on your bank statement';
    case 'monthsLeft':
      return 'repayment schedule (instalments not yet paid), or the bank app';
    case 'prepayFee':
      return 'KFS, "Foreclosure charges"';
    case 'lockIn':
      return 'sanction letter or loan agreement, prepayment clause';
    case 'processingFee':
      return 'KFS, "Processing fees"';
    case 'insurance':
      return 'KFS, "Insurance charges"';
    case 'creditScore':
      return 'a free yearly report from CIBIL, Experian or CRIF, or your bank app';
    case 'takeHome':
      return 'payslip, "Net pay", or the salary credit on your bank statement';
    case 'taxRate':
      return 'your slab: Form 16 or last year’s ITR';
    case 'loanStart':
      return 'sanction letter or first statement; for a switch, the bank’s conversion letter';
    case 'startRate':
      return 'sanction letter or KFS, "Rate of interest"';
    case 'spread':
      return 'KFS, "Spread" (rate = benchmark + spread)';
    case 'savingsRate':
      return 'FD receipt or the bank app’s savings rate';
    case 'offerFee':
      return 'the offer’s KFS, "Processing fees" (a lender must give it before you sign)';
    case 'offerRate':
      return 'the offer’s KFS, "Rate of interest"';
    case 'taxableIncome':
      return 'Form 16 or last year’s ITR, "Total income"';
    case 'purchasePrice':
      return 'sale deed or agreement; for shares or funds, the contract note or statement';
    default:
      return null;
  }
}

function us(key: FindKey, t?: string): string | null {
  if (isCard(t)) {
    switch (key) {
      case 'balance':
        return 'card statement, "New balance"';
      case 'rate':
        return 'card statement, "Interest charge calculation" (purchase APR)';
      case 'statementDay':
        return 'card statement, "Closing date"';
      case 'dueDay':
        return 'card statement, "Payment due date"';
      case 'cardMinimum':
        return 'card statement, "Minimum payment due"';
      case 'emi':
        return 'what you paid the card last month';
    }
  }
  const mortgage = isMortgage(t);
  switch (key) {
    case 'balance':
      return mortgage ? 'mortgage statement, "Principal balance"' : 'loan statement or the lender app, "Principal balance"';
    case 'rate':
      return mortgage
        ? 'mortgage statement or Closing Disclosure p.1, "Interest rate"'
        : 'Truth in Lending box, "Annual percentage rate"';
    case 'rateType':
      return mortgage ? 'Closing Disclosure p.1, "Can this amount increase after closing?"' : 'loan agreement, rate section';
    case 'rateBasis':
      return 'Closing Disclosure p.4, "Adjustable interest rate (AIR) table", index';
    case 'resetFrequency':
      return 'Closing Disclosure p.4, AIR table, "Subsequent changes"';
    case 'nextReset':
      return 'AIR table "First change", or the notice your servicer must send before a change';
    case 'emi':
      return mortgage ? 'mortgage statement, principal and interest (leave out escrow)' : 'loan statement, "Monthly payment"';
    case 'monthsLeft':
      return 'statement maturity date, or the lender app’s payoff schedule';
    case 'prepayFee':
      return mortgage ? 'Closing Disclosure p.1, "Prepayment penalty"' : 'loan agreement, prepayment clause';
    case 'lockIn':
      return 'loan agreement, prepayment clause';
    case 'processingFee':
      return mortgage ? 'Closing Disclosure p.2, "Origination charges"' : 'Truth in Lending box, "Finance charge"';
    case 'insurance':
      return mortgage ? 'Closing Disclosure p.2, mortgage insurance' : 'loan agreement, credit insurance';
    case 'creditScore':
      return 'your card issuer’s app or statement (most show a FICO or VantageScore)';
    case 'takeHome':
      return 'pay stub, "Net pay"';
    case 'taxRate':
      return 'your bracket: taxable income on last year’s Form 1040';
    case 'savingsRate':
      return 'the account’s APY in your bank app';
    case 'offerFee':
      return mortgage ? 'Loan Estimate p.2, "Origination charges"' : 'the offer’s Truth in Lending box, "Finance charge"';
    case 'offerRate':
      return mortgage ? 'Loan Estimate p.1, "Interest rate"' : 'the offer’s Truth in Lending box, "Annual percentage rate"';
    case 'taxableIncome':
      return 'last year’s Form 1040, "Taxable income"';
    case 'purchasePrice':
      return 'closing statement; for shares or funds, the cost basis on Form 1099-B';
    default:
      return null;
  }
}

/** Where to find `key` for this country and loan type, or null when the
 *  figure is the borrower's own call (a forecast, a choice). */
export function whereToFind(key: FindKey, ctx: Ctx): string | null {
  return ctx.country === 'US' ? us(key, ctx.loanType) : india(key, ctx.loanType);
}
