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
import type { LoanType } from './api';
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

interface InstitutionRateCard {
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
