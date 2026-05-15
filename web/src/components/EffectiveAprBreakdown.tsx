'use client';

/**
 * Per-loan effective APR breakdown.
 *
 * Shows nominal → (tax shield) → (GST) → (fees) → effective APR as a
 * vertical list of signed contributions, mirroring how the engine computes
 * it. Used in two places:
 *
 *   1. Setup Step 2 — live preview under each loan card, updates as the
 *      user types nominal rate / processing fee.
 *   2. Debts page — collapsed under each row, opens on demand.
 *
 * Both surfaces share the same component so the math is computed and
 * rendered identically — what the user sees in Setup is what they'll see
 * in Debts.
 */
import type { LoanPayload, Country, TaxRegimeIN } from '@/lib/api';
import { computeBreakdown, fmt } from '@/lib/effective-apr';
import { RATE_CARD_AS_OF } from '@/lib/banks';
import { RateRangeHint } from '@/components/RateRangeHint';

export function EffectiveAprBreakdown({
  loan,
  marginalTaxRate,
  country,
  taxRegime,
  variant = 'card',
}: {
  loan: LoanPayload;
  marginalTaxRate: string;
  country: Country;
  taxRegime?: TaxRegimeIN;
  /** 'card' = boxed surface for Setup; 'inline' = minimal for table-row use. */
  variant?: 'card' | 'inline';
}) {
  const { lines, effective, summary } = computeBreakdown(
    loan,
    marginalTaxRate,
    country,
    taxRegime,
  );

  const nominal = Number(loan.nominal_rate || '0');
  if (nominal <= 0) {
    return (
      <div
        className="muted"
        style={{
          fontSize: 12,
          padding: variant === 'card' ? '10px 12px' : '6px 0',
          border: variant === 'card' ? '1px dashed var(--border)' : 'none',
          borderRadius: variant === 'card' ? 6 : 0,
          fontStyle: 'italic',
        }}
      >
        Enter the nominal rate to see your effective APR breakdown.
      </div>
    );
  }

  const isCard = variant === 'card';
  return (
    <div
      style={{
        padding: isCard ? '12px 14px' : '8px 0',
        background: isCard ? 'var(--soft-bg)' : 'transparent',
        border: isCard ? '1px solid var(--border)' : 'none',
        borderRadius: isCard ? 6 : 0,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <div
        style={{
          fontSize: 11,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: 'var(--muted)',
          fontWeight: 600,
        }}
      >
        Effective APR breakdown
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr auto',
          gap: '6px 12px',
          fontSize: 13,
          fontFamily: 'var(--font-sans)',
        }}
      >
        {lines.map((line, i) => (
          <div key={i} style={{ display: 'contents' }}>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={{ color: 'var(--ink)' }}>{line.label}</span>
              {line.note && (
                <span
                  style={{ fontSize: 11, color: 'var(--muted)', fontStyle: 'italic' }}
                >
                  {line.note}
                </span>
              )}
            </div>
            <span
              className="num"
              style={{
                fontFamily: 'var(--font-mono)',
                textAlign: 'right',
                color: line.sign === '−' ? 'var(--positive)' : 'var(--ink)',
                whiteSpace: 'nowrap',
              }}
            >
              {line.sign} {fmt(line.value)}
            </span>
          </div>
        ))}
        <div
          style={{
            gridColumn: '1 / -1',
            borderTop: '1px solid var(--ink)',
            marginTop: 2,
          }}
        />
        <div style={{ fontWeight: 700 }}>Effective APR</div>
        <span
          className="num"
          style={{
            fontFamily: 'var(--font-mono)',
            textAlign: 'right',
            fontWeight: 700,
            color: effective.gt(loan.nominal_rate || '0') ? 'var(--negative)' : 'var(--positive)',
          }}
        >
          = {fmt(effective)}
        </span>
      </div>
      <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.5 }}>
        {summary}
      </div>
      <RateRangeHint
        bank={loan.bank}
        loanType={loan.loan_type}
        userRate={loan.nominal_rate}
        variant="card"
      />
      <div
        style={{
          fontSize: 10,
          color: 'var(--muted)',
          letterSpacing: '0.04em',
          marginTop: 2,
          fontStyle: 'italic',
          lineHeight: 1.5,
        }}
      >
        GST + fee assumptions reflect rate cards verified {RATE_CARD_AS_OF}.
        Verify against your latest bank statement.
      </div>
    </div>
  );
}
