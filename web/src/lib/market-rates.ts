/**
 * What banks actually lent at last quarter, beside the user's own rate
 * (roadmap PR G).
 *
 * RBI requires banks to publish the range and mean of the interest rates on
 * loans contracted in the past quarter, by category (RBI/2014-15/422,
 * "Display of information by banks", 22 Jan 2015, para 2(a)). The weekly job
 * (scripts/fetch_rate_disclosures.py) reads each bank's own page and commits
 * ./rate-disclosures.json; every figure here comes from that file, with its
 * bank, quarter and source link. A bank whose page couldn't be read isn't in
 * the file, so it isn't shown. Nothing is filled in or guessed.
 */
import type { LoanType } from './api';
import { emiFor } from './rate-decision';
import { GST_RATE_IN } from './gst';
import raw from './rate-disclosures.json';

export interface DisclosureRow {
  label: string;
  category: string | null;
  min: string | null;
  max: string | null;
  mean: string;
  mean_kind: string;
  apr_min: string | null;
  apr_max: string | null;
  apr_mean: string | null;
  period_start: string;
  period_end: string;
  period_label: string;
}

export interface DisclosureLender {
  lender_id: string;
  name: string;
  source_url: string;
  fetched_at: string;
  rows: DisclosureRow[];
}

export interface DisclosureFile {
  rule: string;
  rule_url: string;
  as_of: string;
  lenders: DisclosureLender[];
}

export interface BankLine {
  name: string;
  min: number | null;
  max: number | null;
  mean: number;
  meanKind: string;
  aprMean: number | null;
  sourceUrl: string;
  fetchedAt: string;
}

export interface MarketView {
  loanType: LoanType;
  periodLabel: string;
  periodEnd: string;
  banks: BankLine[];
  /** Across banks that publish a range. */
  low: number | null;
  high: number | null;
  /** The middle of the banks' means: what a typical borrower paid. */
  typicalMean: number;
  asOf: string;
  rule: string;
  ruleUrl: string;
}

const FILE = raw as DisclosureFile;

const NOUN: Partial<Record<LoanType, string>> = {
  personal_loan: 'personal loans',
  home_loan: 'home loans',
  auto_loan: 'new-car loans',
  education_loan: 'education loans',
  gold_loan: 'gold loans',
};

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** The latest quarter's disclosures for one kind of loan, or null. */
export function marketFor(loanType: LoanType, file: DisclosureFile = FILE): MarketView | null {
  if (!NOUN[loanType]) return null;
  const rows: { lender: DisclosureLender; row: DisclosureRow }[] = [];
  for (const lender of file.lenders) {
    for (const row of lender.rows) {
      if (row.category === loanType) rows.push({ lender, row });
    }
  }
  if (!rows.length) return null;
  const latest = rows.reduce((m, r) => (r.row.period_end > m ? r.row.period_end : m), '');
  const current = rows.filter((r) => r.row.period_end === latest);
  // One line per bank (a bank with two pages for one category keeps the first).
  const seen = new Set<string>();
  const banks: BankLine[] = [];
  for (const { lender, row } of current) {
    if (seen.has(lender.name)) continue;
    seen.add(lender.name);
    banks.push({
      name: lender.name,
      min: row.min == null ? null : Number(row.min),
      max: row.max == null ? null : Number(row.max),
      mean: Number(row.mean),
      meanKind: row.mean_kind,
      aprMean: row.apr_mean == null ? null : Number(row.apr_mean),
      sourceUrl: lender.source_url,
      fetchedAt: lender.fetched_at,
    });
  }
  banks.sort((a, b) => a.mean - b.mean);
  const ranged = banks.filter((b) => b.min != null && b.max != null);
  return {
    loanType,
    periodLabel: current[0].row.period_label,
    periodEnd: latest,
    banks,
    low: ranged.length ? Math.min(...ranged.map((b) => b.min!)) : null,
    high: ranged.length ? Math.max(...ranged.map((b) => b.max!)) : null,
    typicalMean: median(banks.map((b) => b.mean)),
    asOf: file.as_of,
    rule: file.rule,
    ruleUrl: file.rule_url,
  };
}

export function pct(x: number): string {
  return `${(Math.round(x * 10000) / 100).toFixed(2).replace(/\.?0+$/, '')}%`;
}

/** "Banks lent personal loans at 8.75–30% in Apr-Jun 2026 (Q1 FY 2026-27); the typical bank's mean was 12.58%." */
export function headline(v: MarketView): string {
  const noun = NOUN[v.loanType]!;
  const n = v.banks.length;
  const range = v.low != null && v.high != null ? ` at ${pct(v.low)}–${pct(v.high)}` : '';
  const who = n === 1 ? v.banks[0].name : `${n} banks`;
  const mean = n === 1 ? `its mean was ${pct(v.typicalMean)}` : `the middle bank's mean was ${pct(v.typicalMean)}`;
  return `${who} lent ${noun}${range} in ${v.periodLabel}; ${mean}.`;
}

/** "HDFC Bank 9.97–24.06% (average 10.89%)", "SBI mean 11.54% (no range published)". */
export function bankLine(b: BankLine): string {
  const kind = b.meanKind === 'mean' ? 'mean' : b.meanKind;
  if (b.min == null || b.max == null) return `${b.name}: ${kind} ${pct(b.mean)}`;
  return `${b.name}: ${pct(b.min)}–${pct(b.max)} (${kind} ${pct(b.mean)})`;
}

/** Where the user's rate sits against what the banks lent at. */
export function position(rate: number, v: MarketView): string {
  if (v.low != null && rate < v.low) return `Your ${pct(rate)} is below every bank's range.`;
  if (v.high != null && rate > v.high) return `Your ${pct(rate)} is above every bank's range.`;
  const below = v.banks.filter((b) => b.mean < rate).length;
  if (below === 0) return `Your ${pct(rate)} is at or below every bank's mean.`;
  if (below === v.banks.length) return `Your ${pct(rate)} is above every bank's mean.`;
  return `Your ${pct(rate)} is above the mean at ${below} of ${v.banks.length} banks.`;
}

export interface RefinanceInput {
  rate: number;                 // fraction
  outstanding: number;
  monthsLeft: number;
  prepaymentFee: number;        // fraction of the amount prepaid
  feeKnown: boolean;            // false: a fixed-rate loan whose fee nobody entered
  gstOnFee: boolean;            // Indian banks add 18% GST to a foreclosure charge
}

export interface RefinanceHint {
  targetRate: number;
  interestSaved: number;
  switchCost: number;
  net: number;
  text: string;
}

/** How far above the typical mean before a switch is worth mentioning. */
export const REFINANCE_GAP = 0.01;
/** The saving left after the foreclosure charge must be at least this share
 *  of the balance: it is the room a new loan's own fees have to fit in. */
export const REFINANCE_MIN_NET_SHARE = 0.01;

/**
 * "You may be able to refinance", only when it is warranted: the rate is a
 * point or more above what the typical bank charged, and moving the balance
 * at that rate for the same months saves more than the foreclosure charge
 * (with GST) by at least 1% of the balance. The new lender's fees aren't
 * known, so the hint says how much room they have.
 */
export function refinanceHint(x: RefinanceInput, v: MarketView, money: (n: number) => string): RefinanceHint | null {
  const target = v.typicalMean;
  if (!(x.outstanding > 0) || x.monthsLeft < 6 || x.rate - target < REFINANCE_GAP) return null;
  const now = emiFor(x.outstanding, x.rate, x.monthsLeft);
  const then = emiFor(x.outstanding, target, x.monthsLeft);
  const saved = (now - then) * x.monthsLeft;
  const switchCost = x.outstanding * x.prepaymentFee * (x.gstOnFee ? 1 + GST_RATE_IN.toNumber() : 1);
  const net = saved - switchCost;
  if (net < x.outstanding * REFINANCE_MIN_NET_SHARE) return null;
  const noun = NOUN[v.loanType]!;
  const fee =
    switchCost > 0
      ? ` Your prepayment fee takes about ${money(switchCost)}${x.gstOnFee ? ' with GST' : ''} of that, leaving ${money(net)}.`
      : x.feeKnown
        ? ''
        : ` Your loan's prepayment fee isn't known; check your agreement, as it comes off this.`;
  const text =
    `You may be able to refinance. Moving ${money(x.outstanding)} to a loan at ${pct(target)}, ` +
    `the middle bank's mean for ${noun} last quarter, would save about ${money(saved)} in interest over the ` +
    `${x.monthsLeft} months left.${fee} A new loan's processing fee and charges would have to come to less than ` +
    `${money(net)} for the switch to pay, and the rate you'd be offered depends on your credit profile.`;
  return { targetRate: target, interestSaved: saved, switchCost, net, text };
}
