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
 *   2. Home's open positions — under each row, opened on demand.
 *
 * Both surfaces share the same component so the math is computed and
 * rendered identically — what the user sees in Setup is what they'll see
 * on Home.
 */
import type Decimal from 'decimal.js';
import type { LoanPayload, Country, IncomeType, TaxRegimeIN } from '@/lib/api';
import { computeBreakdown, fmt } from '@/lib/effective-apr';
import { trueApr, trueAprInputsFromBreakdown } from '@/lib/true-apr';
import { RATE_CARD_AS_OF } from '@/lib/banks';
import { RateRangeHint } from '@/components/RateRangeHint';

export function EffectiveAprBreakdown({
  loan,
  marginalTaxRate,
  country,
  taxRegime,
  variant = 'card',
  incomeType,
  itemises,
}: {
  loan: LoanPayload;
  marginalTaxRate: string;
  country: Country;
  taxRegime?: TaxRegimeIN;
  /** 'card' = boxed surface for Setup; 'inline' = minimal for table-row use. */
  variant?: 'card' | 'inline';
  incomeType?: IncomeType;
  /** US: the share of mortgage interest that lowers tax,
   *  `usMortgageShieldShare(user)`, so the breakdown matches the rate shown
   *  beside it. Omitted: all of it (the setup preview, as labelled there). */
  itemises?: Decimal;
}) {
  const { lines, effective, summary } = computeBreakdown(
    loan,
    marginalTaxRate,
    country,
    taxRegime,
    itemises ?? true,
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
      <TrueAnnualCost loan={loan} lines={lines} />
      <RateRangeHint
        bank={loan.bank}
        loanType={loan.loan_type}
        userRate={loan.nominal_rate}
        variant="card"
        incomeType={incomeType}
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

/** The true annual cost from the cash flows (lib/true-apr, the engine's
 *  engine/true_apr.py): monthly compounding, GST, fees and the tax benefit,
 *  each shown as what it adds or takes off. */
export function TrueAnnualCost({ loan, lines }: { loan: LoanPayload; lines: ReturnType<typeof computeBreakdown>['lines'] }) {
  const t = trueApr(trueAprInputsFromBreakdown(loan, lines));
  const row = (label: string, v: number) =>
    Math.abs(v) < 0.00005 ? null : (
      <div key={label} style={{ display: 'contents' }}>
        <span>{label}</span>
        <span className="num" style={{ fontFamily: 'var(--font-mono)', textAlign: 'right' }}>
          {v < 0 ? '−' : '+'} {fmt(Math.abs(v))}
        </span>
      </div>
    );
  return (
    <div aria-label="True annual cost" style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '4px 12px', fontSize: 12, color: 'var(--muted)' }}>
      <span style={{ gridColumn: '1 / -1', fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 600 }}>
        True annual cost (compounded monthly)
      </span>
      <span>Nominal rate</span>
      <span className="num" style={{ fontFamily: 'var(--font-mono)', textAlign: 'right' }}>{fmt(t.nominal)}</span>
      {row('Monthly compounding', t.compounding)}
      {row('Processing fee and insurance', t.fees)}
      {row('GST on interest and fees', t.gst)}
      {row('Tax benefit', t.tax)}
      <span style={{ fontWeight: 700, color: 'var(--ink)' }}>True annual cost</span>
      <span className="num" style={{ fontFamily: 'var(--font-mono)', textAlign: 'right', fontWeight: 700, color: 'var(--ink)' }}>= {fmt(t.apr)}</span>
    </div>
  );
}
