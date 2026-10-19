/**
 * Placeholders by loan kind and field (Audit 80 B7; UX50 C-11).
 *
 * A placeholder is read as a typical value, so a ₹1.5 lakh EMI example made a
 * ₹5,200-EMI user wonder whether they were in the right box. These are
 * round, illustrative figures of the right scale for each kind, not data,
 * and they never claim to be anyone's rate or balance. Tool money fields get
 * none (ToolPrimitives no longer falls back to "e.g. 1,50,000").
 */
import type { LoanType } from './api';

type Ccy = 'INR' | 'USD';

const BALANCE: Record<Ccy, Record<LoanType, string>> = {
  INR: {
    credit_card: 'e.g. 45,000',
    personal_loan: 'e.g. 3,00,000 or 3L',
    auto_loan: 'e.g. 6,00,000 or 6L',
    home_loan: 'e.g. 25,00,000 or 25L',
    education_loan: 'e.g. 8,00,000 or 8L',
    gold_loan: 'e.g. 1,00,000 or 1L',
    bnpl: 'e.g. 12,000',
    loan_against_property: 'e.g. 30,00,000 or 30L',
    home_topup: 'e.g. 5,00,000 or 5L',
    two_wheeler_loan: 'e.g. 80,000',
    medical_loan: 'e.g. 1,50,000',
    people_loan: 'e.g. 50,000',
  },
  USD: {
    credit_card: 'e.g. 5,000',
    personal_loan: 'e.g. 12,000',
    auto_loan: 'e.g. 20,000',
    home_loan: 'e.g. 250,000',
    education_loan: 'e.g. 25,000',
    gold_loan: 'e.g. 5,000',
    bnpl: 'e.g. 600',
    loan_against_property: 'e.g. 200,000',
    home_topup: 'e.g. 40,000',
    two_wheeler_loan: 'e.g. 3,000',
    medical_loan: 'e.g. 4,000',
    people_loan: 'e.g. 2,000',
  },
};

const EMI: Record<Ccy, Record<LoanType, string>> = {
  INR: {
    credit_card: '',
    personal_loan: 'e.g. 9,500',
    auto_loan: 'e.g. 14,000',
    home_loan: 'e.g. 22,000',
    education_loan: 'e.g. 12,000',
    gold_loan: 'e.g. 5,000',
    bnpl: 'e.g. 3,000',
    loan_against_property: 'e.g. 32,000',
    home_topup: 'e.g. 6,000',
    two_wheeler_loan: 'e.g. 3,500',
    medical_loan: 'e.g. 7,000',
    people_loan: 'e.g. 2,000',
  },
  USD: {
    credit_card: '',
    personal_loan: 'e.g. 400',
    auto_loan: 'e.g. 450',
    home_loan: 'e.g. 1,600',
    education_loan: 'e.g. 280',
    gold_loan: 'e.g. 200',
    bnpl: 'e.g. 100',
    loan_against_property: 'e.g. 1,800',
    home_topup: 'e.g. 400',
    two_wheeler_loan: 'e.g. 120',
    medical_loan: 'e.g. 150',
    people_loan: 'e.g. 100',
  },
};

export function balancePlaceholder(type: LoanType, ccy: Ccy): string {
  return BALANCE[ccy][type];
}

export function emiPlaceholder(type: LoanType, ccy: Ccy): string | undefined {
  return EMI[ccy][type] || undefined;
}
