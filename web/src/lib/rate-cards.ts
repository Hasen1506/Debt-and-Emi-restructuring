/**
 * Typed wrapper around `rate-cards.json`.
 *
 * The JSON is generated from `engine/rate_cards.py` by
 * `scripts/export_rate_cards.py` — run that whenever the engine's
 * hand-seeded rate cards change. When live scrapers land, they will
 * write to the same JSON file in the same shape; this wrapper does not
 * need to change.
 *
 * Two helpers cover all current callers:
 *   • getRateRange(bank, loanType) → low/high decimal pair or null
 *   • describePosition(userRate, range) → human phrase like
 *       "below your bank's typical 7.75–8.15% range"
 */
import Decimal from 'decimal.js';
import type { Country, IncomeType, LoanType } from './api';
import {
  classifyCreditScore,
  classifyIncomeBand,
  getIncomeBenchmark,
  type IncomeBand,
  type ScoreBand,
} from './income-benchmarks';
import raw from './rate-cards.json';

export interface RateRange {
  low: string;
  high: string;
}

interface CreditCardCard {
  apr_low: string;
  apr_high: string;
  cash_advance_low: string | null;
  cash_advance_high: string | null;
  bt_promo_rate: string | null;
  bt_promo_months: number | null;
  bt_fee_pct: string | null;
}

export interface InstitutionRateCard {
  institution_id: string;
  country: 'IN' | 'US';
  name: string;
  scrape_tier: 'A' | 'B' | 'C';
  home_loan: RateRange | null;
  personal_loan: RateRange | null;
  auto_loan: RateRange | null;
  education_loan: RateRange | null;
  credit_card: CreditCardCard | null;
  processing_fee_pct: string | null;
  prepayment_penalty_floating: string;
  /** Bank-specific late-payment flat fee, currency-native. null → fall back
   *  to the country/loan-type defaults in `estimate-penalty.ts`. */
  late_payment_flat_fee: string | null;
  /** Bank-specific penal rate (annualised). null → use defaults. */
  late_payment_penal_rate: string | null;
  last_verified: string;
  is_indicative: boolean;
}

interface RateCardsFile {
  as_of: string;
  source: string;
  institutions: Record<string, InstitutionRateCard>;
}

const data = raw as unknown as RateCardsFile;

export const RATE_CARDS_AS_OF = data.as_of;

/** Median of the Tier-A banks' mid-rates for a loan type in a country, as
 *  a fraction: the same figure the API's market median gives
 *  (engine/rate_cards.market_median), for use before it loads. */
export function tierAMedian(country: 'IN' | 'US', loanType: 'home_loan' | 'auto_loan' | 'personal_loan'): number | null {
  const mids = Object.values(data.institutions)
    .filter((c) => c.country === country && c.scrape_tier === 'A' && c[loanType])
    .map((c) => (Number(c[loanType]!.low) + Number(c[loanType]!.high)) / 2)
    .sort((a, b) => a - b);
  if (!mids.length) return null;
  const n = mids.length;
  return n % 2 ? mids[(n - 1) / 2] : (mids[n / 2 - 1] + mids[n / 2]) / 2;
}
export const RATE_CARDS_SOURCE = data.source;

export function getInstitution(bank: string): InstitutionRateCard | null {
  if (!bank) return null;
  return data.institutions[bank] ?? null;
}

/**
 * Indicative range for `bank`'s `loanType` product. Returns null if the
 * bank or product is not tracked. Credit cards return the APR range.
 */
export function getRateRange(bank: string, loanType: LoanType): RateRange | null {
  const card = getInstitution(bank);
  if (!card) return null;
  switch (loanType) {
    case 'home_loan':
      return card.home_loan;
    case 'personal_loan':
      return card.personal_loan;
    case 'auto_loan':
      return card.auto_loan;
    case 'education_loan':
      return card.education_loan;
    case 'credit_card':
      return card.credit_card
        ? { low: card.credit_card.apr_low, high: card.credit_card.apr_high }
        : null;
    default:
      return null;
  }
}

export function formatRange(r: RateRange): string {
  const low = new Decimal(r.low).mul(100).toFixed(2);
  const high = new Decimal(r.high).mul(100).toFixed(2);
  return `${low}–${high}%`;
}

export type Position = 'below' | 'cheap' | 'fair' | 'expensive' | 'above';

export interface PositionInfo {
  position: Position;
  /** 0..1 ratio of (userRate − low) / (high − low). May be <0 or >1. */
  ratio: number;
  /** Human-readable phrase, e.g. "in the cheap third of HDFC's range". */
  phrase: string;
}

/**
 * Where the user's rate sits inside the bank's published range.
 *
 * The phrases avoid value-laden language ("you got a good deal") and stick
 * to factual placement, because the user's rate is real and the range is
 * indicative — we shouldn't congratulate or alarm them on stale data.
 */
export function describePosition(
  userRate: string | Decimal,
  bank: string,
  range: RateRange,
): PositionInfo {
  const u = new Decimal(userRate);
  const lo = new Decimal(range.low);
  const hi = new Decimal(range.high);
  const span = hi.sub(lo);
  const ratio = span.isZero() ? 0.5 : u.sub(lo).div(span).toNumber();
  let position: Position;
  if (u.lt(lo)) position = 'below';
  else if (u.gt(hi)) position = 'above';
  else if (ratio < 0.33) position = 'cheap';
  else if (ratio < 0.66) position = 'fair';
  else position = 'expensive';

  const bankLabel = bank || 'this lender';
  const rangeStr = formatRange(range);
  switch (position) {
    case 'below':
      return {
        position,
        ratio,
        phrase: `Below ${bankLabel}'s typical range (${rangeStr}) — worth confirming on your latest statement.`,
      };
    case 'above':
      return {
        position,
        ratio,
        phrase: `Above ${bankLabel}'s typical range (${rangeStr}) — possible refinance candidate.`,
      };
    case 'cheap':
      return {
        position,
        ratio,
        phrase: `In the cheap third of ${bankLabel}'s typical range (${rangeStr}).`,
      };
    case 'fair':
      return {
        position,
        ratio,
        phrase: `In the middle of ${bankLabel}'s typical range (${rangeStr}).`,
      };
    case 'expensive':
      return {
        position,
        ratio,
        phrase: `In the upper third of ${bankLabel}'s typical range (${rangeStr}).`,
      };
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Rate prediction
//
// "Likely rate for someone with your profile" — driven by income vs. median
// (banks reserve their lower band for above-median borrowers) and credit
// score (a 800+ borrower at any income level usually clears the lower
// tier). Used by the prefill chip in setup so users who don't know their
// rate get a defensible starting number with explicit reasoning.
//
// Output rates are always inside the published range. Predictions are
// intentionally conservative (bias toward higher) — the failure mode of
// "we predicted lower than reality" is worse for a debt planner than the
// reverse: an optimistic prediction silently understates projected
// interest and over-promises the debt-free date.
// ────────────────────────────────────────────────────────────────────────────

export interface RatePrediction {
  /** Predicted nominal rate as a decimal (e.g. "0.0725" for 7.25%). */
  rate: string;
  /** 0..1 ratio inside [range.low, range.high]. 0 = bottom of band. */
  ratio: number;
  /** One-line rationale, e.g. "salaried · above-median income → lower
   *  third of HDFC's range". Shown next to the chip so users see why. */
  rationale: string;
  /** Inputs that actually contributed. Useful for the UI to know whether
   *  to nudge the user to enter a credit score for a better prediction. */
  usedIncomeBand: IncomeBand;
  usedScoreBand: ScoreBand | null;
}

/**
 * Maps (income band, score band) to a target ratio inside [low, high].
 *
 * 0 = bottom of range (cheapest), 1 = top (most expensive). The ratios are
 * shifted right vs. a pure linear mapping — a "high" income band lands at
 * 0.20 not 0.0, because even top borrowers rarely get the absolute floor
 * of a bank's published range.
 *
 * Credit score overrides income when present and stronger. CIBIL 800+
 * pulls toward 0.10 regardless of income, since at that tier the lender
 * is competing for the borrower; low score pushes up to ~0.75 because
 * the bank prices risk into every offer.
 */
function targetRatio(income: IncomeBand, score: ScoreBand | null): number {
  // Score-driven floors and ceilings — these win when present.
  if (score === 'top') return 0.10;
  if (score === 'weak') return 0.75;

  // Otherwise blend income band with a softer score nudge.
  let base: number;
  switch (income) {
    case 'high': base = 0.20; break;
    case 'above': base = 0.35; break;
    case 'below': base = 0.60; break;
    case 'low': base = 0.80; break;
  }
  if (score === 'strong') base = Math.max(0.15, base - 0.10);
  if (score === 'fair') base += 0.05;
  return Math.min(0.85, Math.max(0.05, base));
}

/**
 * Predict where in the bank's range a user would likely fall.
 *
 * Inputs:
 *   • range — the bank's published low/high for this product
 *   • country, incomeType — drive the median benchmark
 *   • monthlyIncome — user's stated monthly income (residence currency).
 *     For business owners with lumpy income, the setup form's
 *     annual_income / 12 is the canonical input.
 *   • creditScore — optional CIBIL/FICO; null when not provided.
 *
 * Returns null when:
 *   • range is degenerate (low > high or both 0).
 *   • monthlyIncome is non-positive (can't classify income band).
 *
 * Business-owner caveat: when no credit score is provided, the predictor
 * adds a small bias toward mid-band (SE borrowers face more variance on
 * actual quotes vs. published range). With a credit score present, this
 * caveat falls away — score is a stronger signal than employment type.
 */
export function predictUserRate(
  range: RateRange,
  country: Country,
  incomeType: IncomeType,
  monthlyIncome: number,
  creditScore?: number | null,
): RatePrediction | null {
  const lo = new Decimal(range.low);
  const hi = new Decimal(range.high);
  if (!lo.isFinite() || !hi.isFinite() || hi.lte(lo)) return null;
  if (!Number.isFinite(monthlyIncome) || monthlyIncome <= 0) return null;

  const benchmark = getIncomeBenchmark(country, incomeType);
  const incomeBand = classifyIncomeBand(monthlyIncome, benchmark);
  const scoreBand = classifyCreditScore(country, creditScore);
  let ratio = targetRatio(incomeBand, scoreBand);

  // SE caveat: lacking a credit score, nudge toward mid-band by half a
  // step. Doesn't trigger when score is present because that's a stronger
  // anchor than employment type.
  if (incomeType === 'business_owner' && scoreBand == null) {
    ratio = (ratio + 0.5) / 2;
  }

  const rate = lo.add(hi.sub(lo).mul(ratio)).toFixed(4);

  const incomeLabel = {
    high: 'well-above-median income',
    above: 'above-median income',
    below: 'below-median income',
    low: 'low income',
  }[incomeBand];
  const scoreLabel = scoreBand
    ? ({
        top: country === 'IN' ? 'CIBIL 800+' : 'FICO 800+',
        strong: country === 'IN' ? 'CIBIL 750-799' : 'FICO 740-799',
        fair: country === 'IN' ? 'CIBIL 700-749' : 'FICO 670-739',
        weak: country === 'IN' ? 'CIBIL <700' : 'FICO <670',
      }[scoreBand])
    : null;

  const empLabel = incomeType === 'business_owner' ? 'self-employed' : 'salaried';
  const rationaleParts = [empLabel, incomeLabel];
  if (scoreLabel) rationaleParts.push(scoreLabel);
  const rationale = rationaleParts.join(' · ');

  return {
    rate,
    ratio,
    rationale,
    usedIncomeBand: incomeBand,
    usedScoreBand: scoreBand,
  };
}
