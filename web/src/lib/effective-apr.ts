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
import { GST_RATE_IN, gstApplies } from './gst';
import { taxType } from '@/lib/loan-types';
const GST_PCT = GST_RATE_IN.mul(100).toFixed(0);

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

function loanMarketOf(loan: Pick<LoanPayload, 'currency'>, country: Country): Country {
  return loan.currency === 'INR' ? 'IN' : loan.currency === 'USD' ? 'US' : country;
}

/** Home-loan interest that lowers tax on other income, as the engine's
 *  `country_cap_home_loan`: ₹2L (old regime) or nothing (new regime). A
 *  let-out loss is set off against other income only up to the same ₹2L
 *  (old) and not at all (new); rental income isn't modelled. */
function homeLoan24bCap(regime: TaxRegimeIN, _propertyUse: string): Decimal {
  void _propertyUse;
  return regime === 'old' ? D('200000') : D('0');
}

/** IRC §163(h)(3)(F): interest on up to $750k of mortgage debt. */
const US_MORTGAGE_DEBT_LIMIT = D('750000');
/** IRC §221: up to $2,500 of student-loan interest a year, above the line. */
const US_STUDENT_LOAN_INTEREST_MAX = D('2500');

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
  /** C7 (audit 80): the user's other loans, so a let-out home's loss gets
   *  only the part of the one ₹2L set-off (s.109(1)(b)) that self-occupied
   *  homes leave, plus 70% of its rent. Without it the loan is alone. */
  allLoans?: LoanPayload[],
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
  const deductibleUS = new Set(['home_loan', 'education_loan']);
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
  } else if (loan.loan_type === 'education_loan' && country === 'US' && annualInterest.gt(0)) {
    const allowed = Decimal.min(annualInterest, US_STUDENT_LOAN_INTEREST_MAX);
    shieldPct = allowed.div(annualInterest).mul(marginal);
    shieldNote = annualInterest.gt(US_STUDENT_LOAN_INTEREST_MAX)
      ? 'IRC §221: up to $2,500 of interest a year is deductible (phases out at higher incomes)'
      : 'IRC §221: student-loan interest deduction (phases out at higher incomes)';
  } else if (taxType(loan) === 'home_loan' && country === 'US' && usShare.lte(0)) {
    shieldNote = 'Standard deduction: mortgage interest saves no tax';
  } else if (deductible.has(taxType(loan)) && annualInterest.gt(0)) {
    let cap: Decimal;
    if (taxType(loan) === 'home_loan' && country === 'IN') {
      cap = homeLoan24bCap(taxRegime ?? 'new', loan.property_use ?? 'self_occupied');
      if (loan.property_use === 'let_out') {
        // Engine let_out_room: rent after municipal tax and 30%, plus what
        // is left of the ₹2L set-off after self-occupied homes (old regime).
        const share = Decimal.min(1, Decimal.max(0, D(loan.tax_share ?? '1')));
        const rentPart = D(loan.annual_rent || '0').mul(share).mul('0.7');
        const soPool = (allLoans ?? [])
          .filter((l) => l !== loan && taxType(l) === 'home_loan' && (l.property_use ?? 'self_occupied') !== 'let_out' && D(l.outstanding || '0').gt(0))
          .reduce((a, l) => a.add(D(l.outstanding || '0').mul(D(l.nominal_rate || '0')).mul(D(l.tax_share ?? '1'))), D(0));
        const setOff = (taxRegime ?? 'new') === 'old' ? Decimal.max(0, D('200000').sub(Decimal.min(soPool, D('200000')))) : D(0);
        cap = rentPart.add(setOff);
      }
      if (cap.isZero()) {
        shieldPct = D('0');
        shieldNote = loan.property_use === 'let_out'
          ? 'No rent entered and no house-property set-off left: the interest lowers no tax'
          : 'New regime: section 24b cap is ₹0';
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
      } else if (taxType(loan) === 'home_loan' && country === 'US') {
        shieldPct = marginal.mul(usShare);
        if (outstanding.gt(US_MORTGAGE_DEBT_LIMIT)) {
          shieldPct = shieldPct.mul(US_MORTGAGE_DEBT_LIMIT).div(outstanding);
        }
        shieldNote = outstanding.gt(US_MORTGAGE_DEBT_LIMIT)
          ? 'IRC §163: only interest on the first $750,000 of mortgage debt is deductible'
          : usShare.lt(1)
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
  } else if (deductible.has(taxType(loan)) && shieldNote) {
    // Still surface why the shield is 0 even though the loan type qualifies.
    lines.push({
      label: 'Tax shield',
      value: D('0'),
      sign: '−',
      note: shieldNote,
    });
  }

  // ─── GST (Indian loans only) ─────────────────────────────────────────────
  // Follows the loan's own market: an INR card held by a US resident still
  // carries Indian GST on its interest.
  if (loanMarketOf(loan, country) === 'IN') {
    if (loan.loan_type === 'credit_card') {
      const gst = nominal.mul(GST_RATE_IN);
      if (gst.gt(0)) {
        lines.push({
          label: `GST on interest (${GST_PCT}%)`,
          value: gst,
          sign: '+',
          note: 'Government levy on card interest',
        });
      }
    } else if (gstApplies('processing_fee')) {
      // Every loan type's processing fee carries GST (gold, education and
      // BNPL were left out before): the one table in engine/tax/gst.py.
      if (processingFee.gt(0)) {
        // The fee is already a yearly rate: GST is 18% of it. It used to
        // be divided again by balance × years, which made it about zero.
        const gst = processingFee.mul(GST_RATE_IN);
        if (gst.gt(0)) {
          lines.push({
            label: `GST on processing fee (${GST_PCT}%)`,
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
