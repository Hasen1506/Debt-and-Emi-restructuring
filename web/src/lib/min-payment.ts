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
import { GST_RATE_IN } from './gst';

export interface MinPaymentExplanation {
  /** Short one-liner like "5% of outstanding or ₹200, whichever is higher". */
  formula: string;
  /** Computed value for the current outstanding, as a Decimal string. */
  estimated: string;
  /** Source tag for the UI: 'bank' (we know this bank's formula) | 'default'. */
  source: 'bank' | 'default';
  /** Bank label echoed back for the UI. */
  bank: string;
  /** Grill #26: no formula has a verified source, so the figure is always an
   *  estimate; the UI shows `advice` beside it. */
  verified: false;
  advice: string;
}

/** What the form says beside a formula figure (engine STATEMENT_MIN_ADVICE). */
export const STATEMENT_MIN_ADVICE =
  'Estimated. Use the minimum amount due on your card statement: type it in once and the plan uses it.';

interface BankFormula {
  /** Display string used in the UI explainer. */
  description: string;
  /** The minimum for a balance and this month's interest, as the engine
   *  works it out (fees, over-limit and past-due amounts left out). */
  compute(outstanding: Decimal, interest: Decimal): Decimal;
}

/** HDFC / ICICI rule; `i` is interest with 18% GST in (engine
 *  pct_of_balance_and_interest). */
function pctOfBalanceAndInterest(o: Decimal, i: Decimal, floor: string): Decimal {
  const fc = i.div(new Decimal(1).add(GST_RATE_IN));
  const gst = i.sub(fc);
  const core = Decimal.max(fc.add(o).mul('0.05'), fc.add(o.mul('0.05')));
  return Decimal.max(gst.add(core), new Decimal(floor));
}

const INDIA: Record<string, BankFormula> = {
  // C14 (audit 80): SBI Card, Axis, HDFC and ICICI from their MITCs, read
  // 14 Oct 2026 (engine/minimum_payments.py FORMULA_SOURCE has the URLs).
  'SBI Card': {
    description: 'interest + GST + fees + EMIs in full, plus 2% of the balance; at least ₹200 (SBI Card MITC)',
    compute: (o, i) => Decimal.max(i.add(o.mul('0.02')), new Decimal('200')),
  },
  'Axis Bank': {
    description: 'interest + taxes + fees + instalments in full, plus 2% of the balance; at least ₹100 (Axis MITC)',
    compute: (o, i) => Decimal.max(i.add(o.mul('0.02')), new Decimal('100')),
  },
  'Yes Bank': {
    description: '5% of the balance or ₹200, whichever is higher',
    compute: (o) => Decimal.max(o.mul('0.05'), new Decimal('200')),
  },
  'IndusInd Bank': {
    description: '5% of the balance or ₹200, whichever is higher',
    compute: (o) => Decimal.max(o.mul('0.05'), new Decimal('200')),
  },
  'RBL Bank': {
    description: '5% of the balance or ₹100, whichever is higher',
    compute: (o) => Decimal.max(o.mul('0.05'), new Decimal('100')),
  },
  'AmEx India': {
    description: '2% of the balance or ₹100, whichever is higher',
    compute: (o) => Decimal.max(o.mul('0.02'), new Decimal('100')),
  },
  'HDFC Bank': {
    description:
      'GST, EMIs and fees in full, plus the larger of 5% of (interest + balance) and interest + 5% of the balance; at least ₹200 (HDFC, from June 2025)',
    compute: (o, i) => pctOfBalanceAndInterest(o, i, '200'),
  },
  'Kotak Mahindra': {
    description: '5% of the balance (or ₹200) plus interest and fees',
    compute: (o, i) => Decimal.max(o.mul('0.05'), new Decimal('200')).add(i),
  },
  'ICICI Bank': {
    description:
      'GST, EMIs and fees in full, plus the larger of 5% of (interest + balance) and interest + 5% of the balance (ICICI, from 1 Mar 2026)',
    compute: (o, i) => pctOfBalanceAndInterest(o, i, '100'),
  },
};

/** 1% of the balance plus the month's interest, or `floor` if that's more:
 *  how most large US issuers set the minimum. */
const onePctPlusInterest = (floor: number): BankFormula => ({
  description: `1% of the balance plus interest and fees, or $${floor}, whichever is higher`,
  compute: (o, i) => Decimal.max(i.add(o.mul('0.01')), new Decimal(floor)),
});

const USA: Record<string, BankFormula> = {
  Chase: onePctPlusInterest(40),
  'Bank of America': onePctPlusInterest(35),
  Citibank: onePctPlusInterest(41),
  'Capital One': onePctPlusInterest(25),
  Discover: {
    description: '2% of the balance, $20 plus interest and fees, or $35, whichever is highest',
    compute: (o, i) => Decimal.max(o.mul('0.02'), i.add(20), new Decimal('35')),
  },
  'American Express': onePctPlusInterest(40),
  'Goldman Sachs': onePctPlusInterest(25),
  Synchrony: {
    description: '3.5% of the balance, 1% plus interest and fees, or $25, whichever is highest',
    compute: (o, i) => Decimal.max(o.mul('0.035'), i.add(o.mul('0.01')), new Decimal('25')),
  },
};

const DEFAULTS: Record<Country, BankFormula> = {
  IN: {
    description: '5% of the balance or ₹200, whichever is higher',
    compute: (o) => Decimal.max(o.mul('0.05'), new Decimal('200')),
  },
  US: {
    description: '1% of the balance plus interest and fees, or $35, whichever is higher',
    compute: (o, i) => Decimal.max(i.add(o.mul('0.01')), new Decimal('35')),
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
  // RBI MD 2022 para 9(b)(ii): an Indian card's minimum covers the month's
  // interest and its 18% GST (no negative amortisation). The floor never asks
  // for more than the card owes.
  const charges = country === 'IN' ? interest.mul(new Decimal(1).add(GST_RATE_IN)) : interest;
  const raw = formula.compute(outstanding, charges);   // the engine passes GST-inclusive interest too
  const floored = country === 'IN' ? Decimal.max(raw, charges) : raw;
  const minimum = Decimal.min(floored, Decimal.max(outstanding.add(charges), 0));
  return {
    formula: formula.description,
    estimated: minimum.toFixed(0),
    source: hit ? 'bank' : 'default',
    bank: loan.bank || '',
    verified: false,
    advice: STATEMENT_MIN_ADVICE,
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
