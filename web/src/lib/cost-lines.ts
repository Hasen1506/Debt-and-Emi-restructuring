/**
 * "What this loan costs a year", every addend named, worked out and sourced
 * (live test #13 and #32, sprint L3).
 *
 * The live test saw a ₹ card at 42% shown as 42.00% + 9.11% + 11.41% =
 * 62.52% with the second addend unnamed, and a home loan at 8.5% shown as
 * 8.84% with a "+0.34%" nobody explained. Both numbers are right for what
 * the app computes (lib/marginal-cost); they just weren't shown:
 *
 *   9.11%  = monthly compounding: 42% ÷ 12 = 3.5% a month, and
 *            (1 + 3.5%)^12 − 1 = 51.11% a year.
 *   11.41% = GST at 18% on each month's interest (3.5% → 4.13% a month),
 *            counted as compounding with it: (1 + 4.13%)^12 − 1 = 62.52%.
 *   0.34%  = the home loan's monthly compounding: (1 + 8.5%/12)^12 − 1.
 *
 * Each line carries the arithmetic (`how`) and, where a rule sets the
 * number, its source with a link. The GST wording follows the numbers: when
 * the GST figure equals 18% of the year's interest (no compounding, the
 * reading of RBI's Master Direction para 9(b)(ii) that G1 is checking), the
 * line says that instead.
 */
import Decimal from 'decimal.js';
import type { MarginalCost } from './marginal-cost';
import { GST_RATE_IN } from './gst';

export interface CostSource {
  label: string;
  url: string;
  /** When the rule was last checked against the source. */
  asOf: string;
}

export interface CostLine {
  key: 'compounding' | 'gst' | 'tax' | 'fee';
  label: string;
  value: Decimal;
  sign: '+' | '−';
  /** The arithmetic behind the number, in plain words. */
  how: string;
  source?: CostSource;
}

/** GST on card interest: 9% CGST + 9% SGST on "financial and related
 *  services" (heading 9971, item (vii)), and loan interest is exempt except
 *  "interest involved in credit card services". GST Council's compiled
 *  service-rate schedule, checked 12 Oct 2026; the 56th Council's changes
 *  (from 22 Sep 2025) moved only insurance items under heading 9971. */
export const GST_CARD_SOURCE: CostSource = {
  label: 'CBIC Notifications 11/2017 and 12/2017-Central Tax (Rate): 18% GST on card interest',
  url: 'https://www.gstcouncil.gov.in/sites/default/files/2024-02/gstservicerates.pdf',
  asOf: '12 Oct 2026',
};

const pct = (v: Decimal.Value, dp = 2) => `${new Decimal(v).times(100).toFixed(dp)}%`;

/** Whether the GST figure lets GST compound with the interest (the app's
 *  formula on 12 Oct 2026) or is a flat 18% of the year's interest. */
export function gstCompounds(mc: Pick<MarginalCost, 'interest' | 'gst'>): boolean {
  const flat = mc.interest.times(GST_RATE_IN);
  return mc.gst.minus(flat).abs().gt('0.00005');
}

/**
 * The lines between "Rate on your statement" and "What it costs you a
 * year", plus the prepayment-fee line below it, for one loan.
 * `taxNote` is the reason for the tax break (lib/effective-apr's note:
 * "Old regime: 24b caps deduction at ₹200000/yr", "IRC §163 …").
 */
export function costLines(
  nominalRate: Decimal.Value,
  mc: MarginalCost,
  opts: { taxNote?: string; monthsLeft?: number; feePct?: Decimal.Value } = {},
): CostLine[] {
  const nominal = new Decimal(nominalRate || 0);
  const monthly = nominal.div(12);
  const lines: CostLine[] = [];
  const compounding = mc.interest.minus(nominal);
  if (compounding.gt('0.00005')) {
    lines.push({
      key: 'compounding',
      label: 'Interest charged monthly, so it compounds',
      value: compounding,
      sign: '+',
      how: `${pct(nominal)} ÷ 12 = ${pct(monthly, 3)} a month on a balance that includes last month's interest: (1 + ${pct(monthly, 3)})^12 − 1 = ${pct(mc.interest)} a year, ${pct(compounding)} more than the yearly rate.`,
    });
  }
  if (mc.gst.gt(0)) {
    const gstPct = GST_RATE_IN.times(100).toFixed(0);
    const total = mc.interest.plus(mc.gst);
    const how = gstCompounds(mc)
      ? `GST at ${gstPct}% on each month's interest: ${pct(monthly, 3)} × 1.${gstPct} = ${pct(monthly.times(GST_RATE_IN.plus(1)), 3)} a month. This figure lets it compound with the interest: (1 + ${pct(monthly.times(GST_RATE_IN.plus(1)), 3)})^12 − 1 = ${pct(total)}, which is ${pct(mc.gst)} above the ${pct(mc.interest)} line. If your statement charges no interest on unpaid GST, the GST part is about ${pct(mc.interest.times(GST_RATE_IN))}.`
      : `GST at ${gstPct}% of the year's interest: ${pct(mc.interest)} × ${gstPct}% = ${pct(mc.gst)}. It is billed with each month's interest and not charged interest itself.`;
    lines.push({
      key: 'gst',
      label: `GST on the interest (${gstPct}%)`,
      value: mc.gst,
      sign: '+',
      how,
      source: GST_CARD_SOURCE,
    });
  }
  if (mc.taxBenefit.gt(0)) {
    lines.push({
      key: 'tax',
      label: 'Tax break on the interest',
      value: mc.taxBenefit,
      sign: '−',
      how: `${opts.taxNote ? `${opts.taxNote}. ` : ''}The interest lowers your tax, so it costs you ${pct(mc.taxBenefit)} a year less. Paying early gives that break up.`,
    });
  }
  if (mc.fee.gt(0)) {
    const k = opts.monthsLeft && opts.monthsLeft > 0 ? opts.monthsLeft : 12;
    lines.push({
      key: 'fee',
      label: 'Prepayment fee, spread over the months left',
      value: mc.fee,
      sign: '−',
      how: `${pct(opts.feePct ?? 0)} of what you prepay, spread over ${k} month${k === 1 ? '' : 's'} left: ${pct(opts.feePct ?? 0)} × 12 ÷ ${k} = ${pct(mc.fee)} a year off what an extra payment saves. From the fee on your loan (entered, or read from its Key Facts Statement).`,
    });
  }
  return lines;
}
