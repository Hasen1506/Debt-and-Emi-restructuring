'use client';

/**
 * What a loan costs a year, line by line: the same figure the loan's row,
 * the dearest flag and the payoff order use (lib/marginal-cost, the engine's
 * MarginalCost.annual_cost). Interest compounded monthly, plus GST on an
 * Indian card (compounding with it), less the tax break an extra payment
 * would give up. A prepayment fee comes off what an extra payment saves.
 *
 * Used in two places with one look:
 *   1. Profile, under each loan as it is typed in (the loan on its own).
 *   2. Home, under a loan's row when opened (with the user's other loans,
 *      so the tax caps are shared as in the plan: pass `cost`).
 *
 * The upfront processing fee and insurance are not in it: already paid,
 * they don't change what a payment saves. Where a loan has them, one line
 * gives its all-in cost over its life (lib/true-apr) and says so.
 */
import type Decimal from 'decimal.js';
import type { LoanPayload, Country, IncomeType, TaxRegimeIN } from '@/lib/api';
import { computeBreakdown, fmt } from '@/lib/effective-apr';
import { loanMarginalCost, type MarginalCost } from '@/lib/marginal-cost';
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
  cost,
}: {
  loan: LoanPayload;
  marginalTaxRate: string;
  country: Country;
  taxRegime?: TaxRegimeIN;
  /** 'card' = boxed surface for Profile; 'inline' = minimal for table-row use. */
  variant?: 'card' | 'inline';
  incomeType?: IncomeType;
  /** US: the share of mortgage interest that lowers tax,
   *  `usMortgageShieldShare(user)`. Omitted: all of it (the Profile preview). */
  itemises?: Decimal;
  /** The loan's cost among the user's loans (Home). Omitted: the loan alone. */
  cost?: MarginalCost;
}) {
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
        Enter the rate on your statement to see what this loan costs a year.
      </div>
    );
  }

  const mc = cost ?? loanMarginalCost(loan, country, marginalTaxRate, taxRegime ?? 'new', itemises ?? true);
  const lines: { label: string; value: Decimal; sign: '+' | '−' }[] = [{ label: 'Interest, compounded monthly', value: mc.interest, sign: '+' }];
  if (mc.gst.gt(0)) lines.push({ label: 'GST on the interest (18%), compounding with it', value: mc.gst, sign: '+' });
  if (mc.taxBenefit.gt(0)) lines.push({ label: 'Tax break on the interest', value: mc.taxBenefit, sign: '−' });
  // Fees paid upfront: not in the yearly cost, but the all-in figure says what they added.
  const { lines: feeLines } = computeBreakdown(loan, marginalTaxRate, country, taxRegime, itemises ?? true);
  const hasUpfront = Number(loan.processing_fee_amortised || 0) > 0 || Number(loan.insurance_premium_pct || 0) > 0;
  const allIn = hasUpfront ? trueApr(trueAprInputsFromBreakdown(loan, feeLines)).apr : null;

  const isCard = variant === 'card';
  const num = { fontFamily: 'var(--font-mono)', textAlign: 'right' as const, whiteSpace: 'nowrap' as const };
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
        What this loan costs a year
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
        <span style={{ color: 'var(--muted)' }}>Rate on your statement</span>
        <span className="num" style={{ ...num, color: 'var(--muted)' }}>{fmt(loan.nominal_rate || 0)}</span>
        {lines.map((line, i) => (
          <div key={i} style={{ display: 'contents' }}>
            <span style={{ color: 'var(--ink)' }}>{line.label}</span>
            <span className="num" style={{ ...num, color: line.sign === '−' ? 'var(--positive)' : 'var(--ink)' }}>
              {line.sign} {fmt(line.value)}
            </span>
          </div>
        ))}
        <div style={{ gridColumn: '1 / -1', borderTop: '1px solid var(--ink)', marginTop: 2 }} />
        <div style={{ fontWeight: 700 }}>What it costs you a year</div>
        <span className="num" style={{ ...num, fontWeight: 700, color: mc.annualCost.gt(loan.nominal_rate || '0') ? 'var(--negative)' : 'var(--positive)' }}>
          = {fmt(mc.annualCost)}
        </span>
        {mc.fee.gt(0) && (
          <>
            <span>Prepayment fee, spread over the months left</span>
            <span className="num" style={{ ...num, color: 'var(--positive)' }}>− {fmt(mc.fee)}</span>
            <span style={{ fontWeight: 700 }}>Each extra payment here saves</span>
            <span className="num" style={{ ...num, fontWeight: 700 }}>= {fmt(mc.total)}</span>
          </>
        )}
      </div>
      <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.5 }}>
        This is the rate the app ranks your loans by and uses to weigh paying
        early against investing.
        {mc.locked && ` Locked against prepayment for ${mc.lockInMonths} more month${mc.lockInMonths === 1 ? '' : 's'}, so it is paid after your open loans.`}
        {allIn != null &&
          ` With the processing fee and insurance you paid upfront, it costs ${fmt(allIn)} a year over its life. Those are already paid, so they don't change what an early payment saves.`}
      </div>
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
