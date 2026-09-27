/**
 * Client-side effective APR breakdown.
 *
 * Mirrors `engine/formulas.effective_rate` so Setup can show a live preview
 * as the user types and Debts can show per-row breakdowns without a network
 * roundtrip. **Keep in sync** with the engine — if the Python formula changes,
 * update this too.
 *
 *   effective = nominal × (1 − shield) + processing_fee + insurance + gst
 *
 *   shield ∈ [0, marginal_tax_rate] — only applies to home (24b in IN /
 *       §163 in US) and education (80E in IN, interest-only) loans. India
 *       home loans under the new regime hit a ₹0 cap, so shield = 0.
 *
 *   gst — India only.
 *     • credit_card: 18% on nominal (charged on interest)
 *     • home / personal / auto: 18% on processing fee, amortised over tenure
 *     • education / gold / BNPL: 0
 */
import Decimal from 'decimal.js';
import type { LoanPayload, Country, TaxRegimeIN } from './api';

export interface BreakdownLine {
  label: string;
  /** decimal pct, e.g. 0.085 for 8.5% */
  value: Decimal;
  /** display sign: '+' adds, '−' subtracts. */
  sign: '+' | '−';
  /** Optional plain-English note shown in italic next to the value. */
  note?: string;
}

export interface Breakdown {
  lines: BreakdownLine[];
  /** Final effective rate as a decimal (0.4248 = 42.48%). */
  effective: Decimal;
  /** Plain-English summary sentence for the tooltip. */
  summary: string;
}

const D = (v: string | number | Decimal) => new Decimal(v);

function homeLoan24bCap(regime: TaxRegimeIN, propertyUse: string): Decimal {
  if (propertyUse === 'let_out') return D('Infinity');
  return regime === 'old' ? D('200000') : D('0');
}

/**
 * Compute the per-loan breakdown and effective APR.
 *
 * Inputs accept either Decimal or string for parity with the API contract
 * (which sends decimals as strings).
 */
export function computeBreakdown(
  loan: LoanPayload,
  marginalTaxRate: string | Decimal,
  country: Country,
  taxRegime: TaxRegimeIN | undefined,
  /** US: the share of mortgage interest that lowers tax (the part of
   *  itemised deductions above the standard deduction); pass
   *  `usMortgageShieldShare(user)`. true = all of it: screens without a
   *  user (the onboarding preview) show the itemiser's figure, as labelled. */
  itemises: boolean | Decimal = true,
): Breakdown {
  const usShare = itemises === true ? D(1) : itemises === false ? D(0) : Decimal.min(1, Decimal.max(0, itemises));
  const nominal = D(loan.nominal_rate || '0');
  const outstanding = D(loan.outstanding || '0');
  const processingFee = D(loan.processing_fee_amortised || '0');
  const insurance = D(loan.insurance_premium_pct || '0');
  const marginal = D(marginalTaxRate || '0');

  const lines: BreakdownLine[] = [
    { label: 'Nominal rate (bank quote)', value: nominal, sign: '+' },
  ];

  // ─── Tax shield ──────────────────────────────────────────────────────────
  const deductibleIN = new Set(['home_loan', 'education_loan']);
  const deductibleUS = new Set(['home_loan']);
  const deductible =
    country === 'IN' ? deductibleIN : deductibleUS;
  const annualInterest = outstanding.mul(nominal);

  let shieldPct = D('0');
  let shieldNote: string | undefined;
  if (
    loan.loan_type === 'education_loan' &&
    country === 'IN' &&
    (taxRegime ?? 'new') === 'new'
  ) {
    // 80E is an old-regime deduction; the engine gives no shield here.
    shieldNote = 'New regime: no 80E deduction';
  } else if (loan.loan_type === 'home_loan' && country === 'US' && usShare.lte(0)) {
    shieldNote = 'Standard deduction: mortgage interest saves no tax';
  } else if (deductible.has(loan.loan_type) && annualInterest.gt(0)) {
    let cap: Decimal;
    if (loan.loan_type === 'home_loan' && country === 'IN') {
      cap = homeLoan24bCap(taxRegime ?? 'new', loan.property_use ?? 'self_occupied');
      if (cap.isZero()) {
        shieldPct = D('0');
        shieldNote = 'New regime: section 24b cap is ₹0';
      } else if (cap.eq(D('Infinity'))) {
        shieldPct = marginal;
      } else {
        const deductibleAmt = Decimal.min(annualInterest, cap);
        shieldPct = deductibleAmt.div(annualInterest).mul(marginal);
        shieldNote = `Old regime: 24b caps deduction at ₹${cap.toFixed(0)}/yr`;
      }
    } else {
      shieldPct = marginal;
      if (loan.loan_type === 'education_loan' && country === 'IN') {
        shieldNote = 'Sec 80E: interest fully deductible';
      } else if (loan.loan_type === 'home_loan' && country === 'US') {
        shieldPct = marginal.mul(usShare);
        shieldNote = usShare.lt(1)
          ? `Only interest above the standard deduction saves tax (${usShare.mul(100).toFixed(0)}% of it)`
          : 'IRC §163: mortgage interest deduction (itemisers)';
      }
    }
  }

  if (shieldPct.gt(0)) {
    lines.push({
      label: 'Tax shield',
      value: nominal.mul(shieldPct),
      sign: '−',
      note: shieldNote,
    });
  } else if (deductible.has(loan.loan_type) && shieldNote) {
    // Still surface why the shield is 0 even though the loan type qualifies.
    lines.push({
      label: 'Tax shield',
      value: D('0'),
      sign: '−',
      note: shieldNote,
    });
  }

  // ─── GST (India only) ────────────────────────────────────────────────────
  if (country === 'IN') {
    if (loan.loan_type === 'credit_card') {
      const gst = nominal.mul(D('0.18'));
      if (gst.gt(0)) {
        lines.push({
          label: 'GST on interest (18%)',
          value: gst,
          sign: '+',
          note: 'Government levy on card interest',
        });
      }
    } else if (
      loan.loan_type === 'personal_loan' ||
      loan.loan_type === 'home_loan' ||
      loan.loan_type === 'auto_loan'
    ) {
      if (processingFee.gt(0)) {
        // The fee is already a yearly rate: GST is 18% of it. It used to
        // be divided again by balance × years, which made it about zero.
        const gst = processingFee.mul(D('0.18'));
        if (gst.gt(0)) {
          lines.push({
            label: 'GST on processing fee (18%)',
            value: gst,
            sign: '+',
            note: 'Annualised over remaining tenure',
          });
        }
      }
    }
  }

  // ─── Fees + insurance ────────────────────────────────────────────────────
  if (processingFee.gt(0)) {
    lines.push({
      label: 'Processing fee (annualised)',
      value: processingFee,
      sign: '+',
    });
  }
  if (insurance.gt(0)) {
    lines.push({
      label: 'Insurance premium',
      value: insurance,
      sign: '+',
    });
  }

  // ─── Sum ─────────────────────────────────────────────────────────────────
  let effective = D('0');
  for (const line of lines) {
    effective = line.sign === '+' ? effective.add(line.value) : effective.sub(line.value);
  }

  // ─── Summary sentence ────────────────────────────────────────────────────
  const spread = effective.sub(nominal);
  let summary: string;
  if (nominal.isZero()) {
    summary = 'Enter the nominal rate to see how it breaks down.';
  } else if (spread.abs().lt(D('0.005'))) {
    summary = `Your effective APR is roughly your nominal rate (${fmt(nominal)}).`;
  } else if (spread.gt(0)) {
    summary = `You actually pay ${fmt(effective)} — ${fmt(spread)} more than the ${fmt(nominal)} quote.`;
  } else {
    summary = `After tax shield, your effective cost is ${fmt(effective)} — ${fmt(spread.abs())} less than the ${fmt(nominal)} headline.`;
  }

  return { lines, effective, summary };
}

export function fmt(d: Decimal | string | number, digits = 2): string {
  return `${D(d).mul(100).toFixed(digits)}%`;
}
