/**
 * One way to state what a loan or card costs (Audit 80 B13 / E2; grill #46).
 *
 * A card used to show five percentages across Setup, Home and Plan (39%,
 * 55.21%, 46.78%, 44.86%, 48.81%). The rule now:
 *   1. The statement's own rate is the main number ("39.00% a year").
 *   2. The all-in rate (interest compounded monthly, plus GST on card
 *      interest in India, less any tax break) is ONE canonical figure, the
 *      effective rate from lib/derived (= marginal-cost annualCost), always
 *      in the same words: "about 55.21% all-in".
 *   3. Its line-by-line breakdown sits behind the existing [WHY …%?].
 * No averages across loans, and no rate *differences* shown as if they were
 * a rate. web/tests/a80-w06-onboarding.cjs guards the words.
 */
import Decimal from 'decimal.js';
import { fmt as fmtPct } from './effective-apr';

export const ALL_IN = 'all-in';

/** "39.00% a year · about 55.21% all-in", or one rate when they match. */
export function rateLine(nominal: Decimal.Value, effective: Decimal.Value): string {
  const n = new Decimal(nominal);
  const e = new Decimal(effective);
  const main = `${fmtPct(n)} a year`;
  if (e.sub(n).abs().lt(0.00005)) return main;
  if (e.lt(n)) return `${main} \u00b7 about ${fmtPct(e)} after the tax break`;
  return `${main} \u00b7 about ${fmtPct(e)} ${ALL_IN}`;
}

/** Home's "why this loan first", with the one all-in figure only (the
 *  breakdown stays in whyFirstLines, behind WHY on the loan row). */
export function whyFirstShort(total: Decimal.Value, nominal: Decimal.Value): string {
  const t = new Decimal(total);
  const n = new Decimal(nominal);
  return `It costs ${fmtPct(n)} a year on the statement, about ${fmtPct(t)} ${ALL_IN}, so each extra payment here saves about that much a year`;
}
