'use client';

/**
 * Renders a small "typical range" hint for a given bank + loan type.
 *
 * Used in two places:
 *   • Setup Step 2 — appears under the Nominal rate field once both bank
 *     and loan type are filled, so users immediately see how their entered
 *     rate compares to the bank's published range.
 *   • EffectiveAprBreakdown — same hint inside the breakdown card.
 *
 * Renders nothing when the bank or loan type isn't tracked, so callers
 * can drop it anywhere without conditional wrappers.
 */

import type { Country, IncomeType, LoanType } from '@/lib/api';
import {
  getInstitution,
  getRateRange,
  formatRange,
  describePosition,
  predictUserRate,
} from '@/lib/rate-cards';

// Audit 80+ A21: a Tier-B/C card was extrapolated from its peers, never read
// off the lender's page. Say so wherever it shows, and never offer it as a
// click-to-fill rate.
export const UNVERIFIED_LABEL = 'typical, unverified';

// Mirrors engine/restructuring_scan._COLLATERAL_BACKED — secured products
// price off the asset, not income type, so we don't add the SE caveat there.
const COLLATERAL_BACKED: LoanType[] = ['home_loan', 'auto_loan'];

export function RateRangeHint({
  bank,
  loanType,
  userRate,
  variant = 'inline',
  incomeType,
  country,
  monthlyIncome,
  creditScore,
  onUsePrediction,
}: {
  bank: string;
  loanType: LoanType;
  /** User's entered nominal rate (decimal string). Optional — when present
   *  we also render where the rate sits inside the range. */
  userRate?: string;
  /** 'inline' = compact line for Setup, 'card' = full callout for breakdown */
  variant?: 'inline' | 'card';
  /** When set, surfaces an employment-type-aware note about where the user's
   *  realistic offer is likely to fall inside the range. */
  incomeType?: IncomeType;
  /** Country + monthlyIncome together unlock the predicted-rate chip.
   *  creditScore is optional and tightens the prediction when provided. */
  country?: Country;
  monthlyIncome?: number;
  creditScore?: number | null;
  /** When provided AND the user hasn't entered a rate yet, the predicted
   *  rate is shown as a clickable chip. Click invokes this with the
   *  predicted decimal string (e.g. "0.0725"). Setup uses this to fill the
   *  rate field; the breakdown card omits it (read-only context). */
  onUsePrediction?: (rate: string) => void;
}) {
  const range = getRateRange(bank, loanType);
  if (!range) return null;
  const card = getInstitution(bank);
  const unverified = !card || card.is_indicative;
  const provenance = unverified ? UNVERIFIED_LABEL : `checked ${card.last_verified}`;

  const showPosition = Boolean(userRate && Number(userRate) > 0);
  const positionInfo = showPosition ? describePosition(userRate!, bank, range) : null;
  // SE caveat is still surfaced when no income data is available; once
  // we have income (and optionally score), the predicted-rate chip
  // already encodes the SE bias, so the caveat would be redundant.
  const seNote =
    incomeType === 'business_owner' &&
    !COLLATERAL_BACKED.includes(loanType) &&
    !(country && monthlyIncome && monthlyIncome > 0)
      ? 'Self-employed offers typically land mid-band; bring 2-3yr ITR + business proof to argue for the lower end.'
      : null;

  // Predicted rate chip — only when the user hasn't entered their own rate
  // (we never silently override an entered value), and only when caller
  // provides enough inputs (income + country at minimum).
  const prediction =
    !unverified && !showPosition && country && monthlyIncome && monthlyIncome > 0 && incomeType
      ? predictUserRate(range, country, incomeType, monthlyIncome, creditScore)
      : null;

  if (variant === 'inline') {
    return (
      <div
        className="muted"
        style={{
          fontSize: 'var(--fs-small)',
          marginTop: 4,
          lineHeight: 1.55,
        }}
      >
        Typical <strong>{bank}</strong> range: {formatRange(range)}{' '}
        <span data-testid="rate-range-provenance" style={{ opacity: 0.7 }}>({provenance})</span>
        {positionInfo && (
          <>
            <br />
            {positionInfo.phrase}
          </>
        )}
        {prediction && (
          <div style={{ marginTop: 6, display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
            <span>Don't know your rate? Likely{' '}
              <strong style={{ color: 'var(--ink)' }}>
                {(Number(prediction.rate) * 100).toFixed(2)}%
              </strong>{' '}
              for {prediction.rationale}.
            </span>
            {onUsePrediction && (
              <button
                type="button"
                onClick={() => onUsePrediction(prediction.rate)}
                style={{
                  fontSize: 'var(--fs-label)', fontFamily: 'var(--font-mono)',
                  padding: '2px 8px',
                  border: '1px solid var(--accent)',
                  borderRadius: 4,
                  background: 'transparent',
                  color: 'var(--accent)',
                  cursor: 'pointer',
                  letterSpacing: '0.04em',
                  textTransform: 'uppercase',
                  fontWeight: 600,
                }}
                title="Fill the rate field with this prediction (you can edit it after)"
              >
                Use this
              </button>
            )}
          </div>
        )}
        {seNote && (
          <>
            <br />
            {seNote}
          </>
        )}
      </div>
    );
  }

  // 'card' variant
  return (
    <div
      style={{
        marginTop: 8,
        padding: '8px 10px',
        background: 'var(--canvas)',
        border: '1px dashed var(--border)',
        borderRadius: 6,
        fontSize: 'var(--fs-dense)',
        lineHeight: 1.5,
        color: 'var(--ink)',
      }}
    >
      <div style={{ color: 'var(--muted)', fontSize: 'var(--fs-small)', marginBottom: 2 }}>
        Versus published range
      </div>
      <div>
        <strong>{bank}</strong> typically quotes{' '}
        <span className="num">{formatRange(range)}</span> for this product
        ({provenance}).
      </div>
      {positionInfo && (
        <div style={{ marginTop: 4, color: 'var(--muted)' }}>
          {positionInfo.phrase}
        </div>
      )}
      {seNote && (
        <div style={{ marginTop: 4, color: 'var(--muted)' }}>
          {seNote}
        </div>
      )}
    </div>
  );
}
