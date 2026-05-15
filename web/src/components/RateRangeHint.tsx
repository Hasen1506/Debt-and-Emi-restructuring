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

import type { LoanType } from '@/lib/api';
import {
  getRateRange,
  formatRange,
  describePosition,
  RATE_CARDS_AS_OF,
} from '@/lib/rate-cards';

export function RateRangeHint({
  bank,
  loanType,
  userRate,
  variant = 'inline',
}: {
  bank: string;
  loanType: LoanType;
  /** User's entered nominal rate (decimal string). Optional — when present
   *  we also render where the rate sits inside the range. */
  userRate?: string;
  /** 'inline' = compact line for Setup, 'card' = full callout for breakdown */
  variant?: 'inline' | 'card';
}) {
  const range = getRateRange(bank, loanType);
  if (!range) return null;

  const showPosition = Boolean(userRate && Number(userRate) > 0);
  const positionInfo = showPosition ? describePosition(userRate!, bank, range) : null;

  if (variant === 'inline') {
    return (
      <div
        className="muted"
        style={{
          fontSize: 11,
          marginTop: 4,
          lineHeight: 1.55,
        }}
      >
        Typical <strong>{bank}</strong> range: {formatRange(range)}{' '}
        <span style={{ opacity: 0.7 }}>(as of {RATE_CARDS_AS_OF})</span>
        {positionInfo && (
          <>
            <br />
            {positionInfo.phrase}
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
        fontSize: 12,
        lineHeight: 1.5,
        color: 'var(--ink)',
      }}
    >
      <div style={{ color: 'var(--muted)', fontSize: 11, marginBottom: 2 }}>
        Versus published range
      </div>
      <div>
        <strong>{bank}</strong> typically quotes{' '}
        <span className="num">{formatRange(range)}</span> for this product
        (verified {RATE_CARDS_AS_OF}).
      </div>
      {positionInfo && (
        <div style={{ marginTop: 4, color: 'var(--muted)' }}>
          {positionInfo.phrase}
        </div>
      )}
    </div>
  );
}
