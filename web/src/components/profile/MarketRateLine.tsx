'use client';

/**
 * Beside a loan's rate: what banks actually lent at last quarter, from their
 * own published disclosures (roadmap PR G, lib/market-rates), with each
 * bank's figures and source link, and a "you may be able to refinance" line
 * only when the saving clears the cost of switching. Shows nothing for a
 * loan type no bank's page covers, a card, or a loan outside India.
 */
import type { Country, LoanPayload } from '@/lib/api';
import { formatINR } from '@/lib/api';
import { loanMarket } from '@/lib/currency';
import { feeShown } from '@/lib/prepayment-fee';
import { bankLine, headline, marketFor, position, refinanceHint } from '@/lib/market-rates';

export function MarketRateLine({ loan, country }: { loan: LoanPayload; country: Country }) {
  if (loan.loan_type === 'credit_card' || loanMarket(loan, country) !== 'IN') return null;
  const view = marketFor(loan.loan_type);
  if (!view) return null;
  const rate = Number(loan.nominal_rate);
  const hasRate = Number.isFinite(rate) && rate > 0;
  const fee = feeShown(loan, country);
  const hint = hasRate
    ? refinanceHint(
        {
          rate,
          outstanding: Number(loan.outstanding) || 0,
          monthsLeft: Number(loan.tenure_months_remaining) || 0,
          prepaymentFee: Number(loan.prepayment_penalty_pct || 0) || 0,
          feeKnown: fee.status !== 'unknown',
          gstOnFee: true,
        },
        view,
        (n) => formatINR(Math.round(n)),
      )
    : null;
  const asOf = view.banks.map((b) => b.fetchedAt.slice(0, 10)).sort().pop() ?? view.asOf;
  return (
    <div data-testid="market-rate-line" className="muted" style={{ fontSize: 11, marginTop: 4, lineHeight: 1.55 }}>
      {headline(view)}
      {hasRate && <> {position(rate, view)}</>}
      <details style={{ marginTop: 2 }}>
        <summary style={{ cursor: 'pointer' }}>
          Each bank&apos;s figures (their own disclosures, read {asOf})
        </summary>
        <ul style={{ margin: '4px 0', paddingLeft: 16 }}>
          {view.banks.map((b) => (
            <li key={b.name}>
              {bankLine(b)}{' '}
              <a href={b.sourceUrl} target="_blank" rel="noreferrer">source</a>
            </li>
          ))}
        </ul>
        <span>
          Rates on loans the banks made in {view.periodLabel}, which RBI asks every bank to publish (
          <a href={view.ruleUrl} target="_blank" rel="noreferrer">RBI, 22 Jan 2015</a>). They are what borrowers
          were charged then, not an offer to you.
        </span>
      </details>
      {hint && (
        <p data-testid="refinance-hint" style={{ margin: '4px 0 0', color: 'var(--ink)' }}>
          {hint.text}
        </p>
      )}
    </div>
  );
}
