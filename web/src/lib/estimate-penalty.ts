/**
 * Late/missed payment penalty estimator — TypeScript port of
 * `engine/penalties.py`. Drives the "would have been charged ~₹X"
 * line next to each Activity ledger entry.
 *
 * Same two-component model: flat fee + penal interest on the overdue
 * amount, with 18% GST in India on consumer-credit penalties. Bank-
 * specific values from `getInstitution(bank)` override the defaults
 * when present.
 *
 * Keep this file numerically in sync with engine/penalties.py — the
 * server is the source of truth, but we mirror here to avoid a roundtrip
 * just for a typical-penalty display.
 */
import Decimal from 'decimal.js';
import type { Country, LoanType } from './api';
import { getInstitution } from './rate-cards';
import { GST_RATE_IN } from './gst';

interface Defaults {
  flatFee: string;
  penalRateAnnual: string;
}

const IN_DEFAULTS: Record<LoanType, Defaults> = {
  home_loan: { flatFee: '500', penalRateAnnual: '0.02' },
  auto_loan: { flatFee: '500', penalRateAnnual: '0.24' },
  personal_loan: { flatFee: '500', penalRateAnnual: '0.24' },
  credit_card: { flatFee: '500', penalRateAnnual: '0' },
  education_loan: { flatFee: '250', penalRateAnnual: '0.02' },
  gold_loan: { flatFee: '0', penalRateAnnual: '0.02' },
  bnpl: { flatFee: '200', penalRateAnnual: '0.36' },
};

const US_DEFAULTS: Record<LoanType, Defaults> = {
  home_loan: { flatFee: '0', penalRateAnnual: '0.05' },
  auto_loan: { flatFee: '25', penalRateAnnual: '0.05' },
  personal_loan: { flatFee: '25', penalRateAnnual: '0.05' },
  credit_card: { flatFee: '30', penalRateAnnual: '0.2999' },
  education_loan: { flatFee: '25', penalRateAnnual: '0.06' },
  gold_loan: { flatFee: '0', penalRateAnnual: '0.05' },
  bnpl: { flatFee: '15', penalRateAnnual: '0.30' },
};


const GST_EXEMPT: Set<LoanType> = new Set(['home_loan']);

export interface PenaltyEstimate {
  flatFee: Decimal;
  penalInterest: Decimal;
  gst: Decimal;
  total: Decimal;
  /** 'bank_specific' if any field came from rate-cards, else 'country_default'. */
  source: 'bank_specific' | 'country_default';
}

export function estimateLateFee({
  loanType,
  country,
  bank,
  overdueAmount,
  daysLate,
}: {
  loanType: LoanType;
  country: Country;
  /** Bank name as stored on the loan; null/empty → use defaults only. */
  bank?: string | null;
  /** Principal+interest the user didn't pay (full EMI for a miss, or
   *  `EMI − amount_paid` for a partial). Decimal or string. */
  overdueAmount: Decimal | string;
  /** Days between due date and now (or until catch-up). Clamps to >=1. */
  daysLate: number;
}): PenaltyEstimate {
  const overdue = Decimal.max(new Decimal(overdueAmount || 0), new Decimal(0));
  const days = Math.max(1, daysLate);

  const defaults = country === 'IN' ? IN_DEFAULTS : US_DEFAULTS;
  const fallback = defaults[loanType];
  const card = bank ? getInstitution(bank) : null;

  let flat: Decimal;
  let source: 'bank_specific' | 'country_default' = 'country_default';
  if (card?.late_payment_flat_fee != null) {
    flat = new Decimal(card.late_payment_flat_fee);
    source = 'bank_specific';
  } else {
    flat = new Decimal(fallback.flatFee);
  }

  let penalRate: Decimal;
  if (card?.late_payment_penal_rate != null) {
    penalRate = new Decimal(card.late_payment_penal_rate);
    source = 'bank_specific';
  } else {
    penalRate = new Decimal(fallback.penalRateAnnual);
  }

  // Simple interest over the late period; matches engine behavior.
  const penalInterest = overdue.mul(penalRate).mul(days).div(365);

  let gst = new Decimal(0);
  if (country === 'IN' && !GST_EXEMPT.has(loanType)) {
    gst = flat.add(penalInterest).mul(GST_RATE_IN);
  }

  const total = flat.add(penalInterest).add(gst);
  return { flatFee: flat, penalInterest, gst, total, source };
}
