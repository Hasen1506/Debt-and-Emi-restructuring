/**
 * Round 3 (u08gig): US self-employment tax, as engine/tax/usa.py
 * `self_employment_tax` (constants exported to tax-tables.json). 15.3%
 * (12.4% Social Security to the $184,500 2026 wage base + 2.9% Medicare) on
 * 92.35% of net earnings, 0.9% Additional Medicare above the filing-status
 * threshold, half of the 15.3% deductible from income. Sources: IRS Topic 554
 * (https://www.irs.gov/taxtopics/tc554), SSA contribution and benefit base
 * (https://www.ssa.gov/oact/cola/cbb.html), IRS estimated-tax due dates
 * (https://www.irs.gov/faqs/estimated-tax/individuals/individuals-2), read 17 Oct 2026.
 */
import type { FilingStatusUS } from './api';
import TAX from './tax-tables.json';

const SE = TAX.us.se;

/** [SE tax for the year, the half deducted from income]. */
export function usSelfEmploymentTax(net: number, filing: FilingStatusUS = 'single'): [number, number] {
  if (!(net >= SE.min_net)) return [0, 0];
  const se = net * SE.net_factor;
  const base = SE.ss_rate * Math.min(se, SE.ss_wage_base) + SE.medicare_rate * se;
  const extra = SE.addl_medicare_rate * Math.max(0, se - SE.addl_medicare_threshold[filing]);
  return [base + extra, base / 2];
}

const usd = (n: number) => `$${n.toLocaleString('en-US')}`;

/** What a self-employed / gig filer owes besides income tax, in one line. */
export const SE_TAX_NOTE =
  `Self-employed, you also owe self-employment tax: 15.3% on 92.35% of your net earnings (the Social Security part stops at ${usd(SE.ss_wage_base)} in 2026), and half of it comes off your income. ` +
  'No employer withholds it, so pay estimated tax each quarter: 15 April, 15 June, 15 September and 15 January (Form 1040-ES).';
