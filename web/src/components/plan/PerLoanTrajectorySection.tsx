'use client';

/**
 * Shared per-loan trajectory section for the three /plan skins.
 *
 * Renders a chart + colour legend showing how each loan's outstanding
 * shrinks over time under the active strategy. The avalanche order
 * becomes obvious: the steepest fall belongs to the highest-effective-
 * APR loan, and as each clears the next one accelerates.
 *
 * Hidden when fewer than 2 loans (the existing total chart already
 * tells that whole story for a single loan).
 */

import Decimal from 'decimal.js';
import { Card } from '@/components/Card';
import {
  PerLoanTrajectoryChart,
  PerLoanLegend,
} from '@/components/PerLoanTrajectoryChart';
import { computeBreakdown } from '@/lib/effective-apr';
import { userDefaultCurrency } from '@/lib/currency';
import type { PlanData } from './PlanData';

export function PerLoanTrajectorySection({ plan }: { plan: PlanData }) {
  const loans = plan.user.loans ?? [];
  if (loans.length < 2) return null;

  // Filter to loans that started with outstanding > 0 — fully-paid-at-start
  // loans wouldn't show up in the chart meaningfully.
  const indexedLoans = loans
    .map((loan, index) => ({ loan, index }))
    .filter(({ loan }) => Number(loan.outstanding || 0) > 0);
  if (indexedLoans.length < 2) return null;

  const taxRegime = plan.user.country === 'IN' ? plan.user.tax_regime : undefined;
  const legend = indexedLoans.map(({ loan, index }) => {
    const { effective } = computeBreakdown(
      loan,
      plan.marginalRate,
      plan.user.country,
      taxRegime,
    );
    return {
      index,
      label: loan.bank || `Loan #${index + 1}`,
      effectiveRatePct: Number(new Decimal(effective).mul(100).toString()),
    };
  });
  // Sort by descending effective rate — avalanche order top-to-bottom in legend.
  legend.sort((a, b) => (b.effectiveRatePct ?? 0) - (a.effectiveRatePct ?? 0));

  const currency = userDefaultCurrency(plan.user.country);

  return (
    <Card>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <div>
          <div style={{ fontWeight: 600, fontSize: 15 }}>Each loan over time</div>
          <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
            Avalanche kills the highest-effective-rate loan first. Watch the
            top of the legend collapse fastest — once it clears, the surplus
            cascades and the next line steepens.
          </div>
        </div>
      </div>
      <div style={{ height: 280, marginTop: 12 }}>
        <PerLoanTrajectoryChart
          data={plan.trajectory}
          loans={legend}
          currency={currency}
        />
      </div>
      <PerLoanLegend loans={legend} />
    </Card>
  );
}
