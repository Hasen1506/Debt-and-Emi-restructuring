/**
 * Income benchmarks used by the rate-prediction chip in setup.
 *
 * These are rough medians, not authoritative figures — the chip is
 * advisory ("here's a likely rate for someone with your profile, click
 * to use it") so over-precision would lend false confidence. We round
 * generously and document the source so it's easy to refresh.
 *
 * Sources (as of 2026-05):
 *   • India salaried median: ₹50,000/month — urban formal-sector,
 *     PLFS 2023-24 + Naukri JobSpeak 2025 cross-reference.
 *   • India SE (declared ITR median): ₹60,000/month — CBDT FY24 data,
 *     business owners filing ITR-3/4 (excludes farmers).
 *   • US salaried median: $5,500/month — BLS Q4 2025 median weekly
 *     earnings × 4.33 for full-time wage and salary workers.
 *   • US SE median: $5,000/month — Census ACS 2024, sole-proprietor
 *     non-farm income.
 *
 * Refresh policy: bump these once a year; tag the constant below with
 * the as-of date so stale benchmarks are obvious in code review.
 */
import type { Country, IncomeType } from './api';

// Benchmarks as of 2026-05.

export interface IncomeBenchmark {
  /** Median monthly income for this country × employment type, in
   *  the country's residence currency (INR for IN, USD for US). */
  median: number;
  /** Currency the median is denominated in. */
  currency: 'INR' | 'USD';
}

export function getIncomeBenchmark(
  country: Country,
  incomeType: IncomeType,
): IncomeBenchmark {
  if (country === 'US') {
    return incomeType === 'business_owner'
      ? { median: 5_000, currency: 'USD' }
      : { median: 5_500, currency: 'USD' };
  }
  // India
  return incomeType === 'business_owner'
    ? { median: 60_000, currency: 'INR' }
    : { median: 50_000, currency: 'INR' };
}

/**
 * Where the user's income places them vs. the median.
 *   • <0.5×    → low band (top of rate range)
 *   • 0.5-1×   → below median (upper third)
 *   • 1-2×     → above median (lower third)
 *   • ≥2×      → high band (bottom of rate range)
 */
export type IncomeBand = 'low' | 'below' | 'above' | 'high';

export function classifyIncomeBand(
  monthlyIncome: number,
  benchmark: IncomeBenchmark,
): IncomeBand {
  // No income (NaN) is not the top band: fall back like a degenerate benchmark.
  if (!Number.isFinite(monthlyIncome) || benchmark.median <= 0) return 'above';
  const ratio = monthlyIncome / benchmark.median;
  if (ratio < 0.5) return 'low';
  if (ratio < 1) return 'below';
  if (ratio < 2) return 'above';
  return 'high';
}

/**
 * Where the user's credit score places them within the bank's rate range.
 *   • CIBIL 800+ / FICO 800+   → top-tier (bottom 10% of range)
 *   • CIBIL 750-799 / FICO 740-799 → strong (bottom 25%)
 *   • CIBIL 700-749 / FICO 670-739 → fair (lower 40%)
 *   • <700 / <670 → weak (top 30%, lender prices up risk)
 *
 * Returns null when the score is missing or out of plausible range.
 */
export type ScoreBand = 'top' | 'strong' | 'fair' | 'weak';

export function classifyCreditScore(
  country: Country,
  score: number | null | undefined,
): ScoreBand | null {
  if (score == null || !Number.isFinite(score)) return null;
  if (country === 'US') {
    if (score < 300 || score > 850) return null;
    if (score >= 800) return 'top';
    if (score >= 740) return 'strong';
    if (score >= 670) return 'fair';
    return 'weak';
  }
  // India CIBIL
  if (score < 300 || score > 900) return null;
  if (score >= 800) return 'top';
  if (score >= 750) return 'strong';
  if (score >= 700) return 'fair';
  return 'weak';
}
