/**
 * Client-side mirror of the engine's bank-specific minimum-payment formulas
 * ([engine/minimum_payments.py](engine/minimum_payments.py)). The engine is
 * still authoritative — this file exists only to (a) tell the user *how*
 * their card minimum is computed, and (b) suggest a sensible value when
 * they want to override.
 *
 * Keep in sync with INDIA_MIN_PAYMENT_FORMULAS / USA_MIN_PAYMENT_FORMULAS.
 */
import Decimal from 'decimal.js';
import type { Country, LoanPayload } from './api';
import { dec } from './safe-decimal';

export interface MinPaymentExplanation {
  /** Short one-liner like "5% of outstanding or ₹200, whichever is higher". */
  formula: string;
  /** Computed value for the current outstanding, as a Decimal string. */
  estimated: string;
  /** Source tag for the UI: 'bank' (we know this bank's formula) | 'default'. */
  source: 'bank' | 'default';
  /** Bank label echoed back for the UI. */
  bank: string;
}

interface BankFormula {
  /** Display string used in the UI explainer. */
  description: string;
  /** The minimum for a balance and this month's interest, as the engine
   *  works it out (fees, over-limit and past-due amounts left out). */
  compute(outstanding: Decimal, interest: Decimal): Decimal;
}

const INDIA: Record<string, BankFormula> = {
  'SBI Card': {
    description: '5% of outstanding or ₹200, whichever is higher, plus interest + fees',
    compute: (o, i) => Decimal.max(o.mul('0.05'), new Decimal('200')).add(i),
  },
  'Axis Bank': {
    description: '5% of outstanding or ₹200, whichever is higher',
    compute: (o) => Decimal.max(o.mul('0.05'), new Decimal('200')),
  },
  'Yes Bank': {
    description: '5% of outstanding or ₹200, whichever is higher',
    compute: (o) => Decimal.max(o.mul('0.05'), new Decimal('200')),
  },
  'IndusInd Bank': {
    description: '5% of outstanding or ₹200, whichever is higher',
    compute: (o) => Decimal.max(o.mul('0.05'), new Decimal('200')),
  },
  'RBL Bank': {
    description: '5% of outstanding or ₹100, whichever is higher',
    compute: (o) => Decimal.max(o.mul('0.05'), new Decimal('100')),
  },
  'AmEx India': {
    description: '2% of outstanding or ₹100, whichever is higher',
    compute: (o) => Decimal.max(o.mul('0.02'), new Decimal('100')),
  },
  'HDFC Bank': {
    description:
      "5% of outstanding (or ₹200) plus the month's EMIs, over-limit and past-due amounts",
    compute: (o) => Decimal.max(o.mul('0.05'), new Decimal('200')),
  },
  'Kotak Mahindra': {
    description: '5% of outstanding (or ₹200) plus interest and fees',
    compute: (o, i) => Decimal.max(o.mul('0.05'), new Decimal('200')).add(i),
  },
  'ICICI Bank': {
    description:
      'Higher of (interest + fees + 1% principal) or 5% of outstanding, floored at ₹100',
    compute: (o, i) => Decimal.max(i.add(o.mul('0.01')), o.mul('0.05'), new Decimal('100')),
  },
};

const USA: Record<string, BankFormula> = {
  Chase: {
    description: '2% of outstanding or $35, whichever is higher',
    compute: (o) => Decimal.max(o.mul('0.02'), new Decimal('35')),
  },
  'Bank of America': {
    description: '1% of outstanding plus interest and fees, floor $35',
    compute: (o, i) => Decimal.max(i.add(o.mul('0.01')), new Decimal('35')),
  },
  Citibank: {
    description: '2% of outstanding or $25, whichever is higher',
    compute: (o) => Decimal.max(o.mul('0.02'), new Decimal('25')),
  },
  'Capital One': {
    description: '2% of outstanding or $25, whichever is higher',
    compute: (o) => Decimal.max(o.mul('0.02'), new Decimal('25')),
  },
  Discover: {
    description: '2% of outstanding or $35, whichever is higher',
    compute: (o) => Decimal.max(o.mul('0.02'), new Decimal('35')),
  },
  'American Express': {
    description: '1% of outstanding plus interest and fees, floor $35',
    compute: (o, i) => Decimal.max(i.add(o.mul('0.01')), new Decimal('35')),
  },
  'Goldman Sachs': {
    description: '1% of outstanding plus interest and fees, floor $35',
    compute: (o, i) => Decimal.max(i.add(o.mul('0.01')), new Decimal('35')),
  },
  Synchrony: {
    description: '2% of outstanding or $25, whichever is higher',
    compute: (o) => Decimal.max(o.mul('0.02'), new Decimal('25')),
  },
};

const DEFAULTS: Record<Country, BankFormula> = {
  IN: {
    description: '5% of outstanding or ₹200, whichever is higher (country default)',
    compute: (o) => Decimal.max(o.mul('0.05'), new Decimal('200')),
  },
  US: {
    description: '2% of outstanding or $35, whichever is higher (country default)',
    compute: (o) => Decimal.max(o.mul('0.02'), new Decimal('35')),
  },
};

// ─── Grace period registry ─────────────────────────────────────────────────

/**
 * Statement-to-due grace period (days) by bank. Used as a smart default
 * for the credit-card due_day input in onboarding — if the user knows
 * their statement_day, we can pre-fill due_day from this table. They
 * can still override.
 *
 * Country fallback: 20 days for IN, 23 for US (median across surveyed
 * issuers). CARD Act mandates ≥21 days for US cards.
 */
const GRACE_DAYS_IN: Record<string, number> = {
  'SBI Card': 20,
  'HDFC Bank': 20,
  'Axis Bank': 21,
  'ICICI Bank': 18,
  'Kotak Mahindra': 20,
  'Yes Bank': 20,
  'IndusInd Bank': 20,
  'RBL Bank': 20,
  'AmEx India': 26,
};

const GRACE_DAYS_US: Record<string, number> = {
  Chase: 21,
  'Bank of America': 25,
  Citibank: 23,
  'Capital One': 25,
  Discover: 25,
  'American Express': 25,
  'Goldman Sachs': 23,
  Synchrony: 23,
};

const GRACE_DEFAULTS: Record<Country, number> = { IN: 20, US: 23 };

export function suggestedGraceDays(bank: string, country: Country): number {
  const registry = country === 'IN' ? GRACE_DAYS_IN : GRACE_DAYS_US;
  return registry[bank] ?? GRACE_DEFAULTS[country];
}

export function explainMinPayment(
  loan: Pick<LoanPayload, 'loan_type' | 'bank' | 'outstanding'> & Partial<Pick<LoanPayload, 'nominal_rate'>>,
  country: Country,
): MinPaymentExplanation | null {
  if (loan.loan_type !== 'credit_card') return null;
  const registry = country === 'IN' ? INDIA : USA;
  const hit = registry[loan.bank];
  const formula = hit ?? DEFAULTS[country];
  const outstanding = dec(loan.outstanding);
  const interest = outstanding.mul(dec(loan.nominal_rate)).div(12);
  return {
    formula: formula.description,
    estimated: formula.compute(outstanding, interest).toFixed(0),
    source: hit ? 'bank' : 'default',
    bank: loan.bank || '(unspecified bank)',
  };
}

/**
 * What the bank requires this month, in the loan's currency: the EMI, or
 * for a card its minimum (the user's override, else the bank's formula on
 * this month's balance and interest), as the engine's
 * compute_total_minimums works it out. A card with no EMI set used to
 * count as ₹0 a month, so someone ₹9,000 short was told to find ₹4,000.
 */
export function requiredMonthly(loan: LoanPayload, country: Country): Decimal {
  if (loan.loan_type !== 'credit_card') return dec(loan.scheduled_emi);
  const override = dec(loan.min_payment_override);
  if (override.gt(0)) return override;
  return new Decimal(explainMinPayment(loan, country)?.estimated ?? 0);
}
