'use client';

/**
 * Per-loan trajectory chart on /insights (moved from /plan in Phase 7).
 *
 * Client-side variant: fetches /api/simulate itself so /insights doesn't
 * need a full plan-data loader. Uses the saved profile's strategy and a
 * 240-month horizon. Falls back silently when the API is unreachable.
 *
 * Hidden when fewer than 2 loans (the chart only makes sense as a
 * comparison between loans).
 */

import { useEffect, useState } from 'react';
import Decimal from 'decimal.js';
import { Card } from '@/components/Card';
import {
  PerLoanTrajectoryChart,
  PerLoanLegend,
} from '@/components/PerLoanTrajectoryChart';
import { computeBreakdown } from '@/lib/effective-apr';
import { usItemises } from '@/lib/deductions';
import { userDefaultCurrency } from '@/lib/currency';
import { InfoTip } from '@/components/ToolPrimitives';
import { api, type Strategy, type UserPayload } from '@/lib/api';
import { HORIZON_MONTHS } from '@/lib/horizon';
import type { TrajectoryPoint } from '@/lib/mock-data';

interface LoanLegendEntry {
  index: number;
  label: string;
  effectiveRatePct?: number;
}

export function InsightsPerLoanTrajectorySection({
  user,
  marginalRate,
  strategy,
}: {
  user: UserPayload;
  marginalRate: string;
  strategy: Strategy;
}) {
  const [points, setPoints] = useState<TrajectoryPoint[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .simulate({
        user,
        strategy,
        horizon_months: HORIZON_MONTHS,
        marginal_rate: marginalRate,
      })
      .then((res) => {
        if (cancelled) return;
        const next: TrajectoryPoint[] = res.trajectory.map((r) => ({
          month: r.month,
          avalanche: Number(r.balance) || 0,
          minimums: 0,
          balancesByLoanIndex: Object.fromEntries(
            Object.entries(r.balances_by_loan_index ?? {}).map(([k, v]) => [
              k,
              Number(v) || 0,
            ]),
          ),
        }));
        setPoints(next);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e?.message ?? e));
      });
    return () => {
      cancelled = true;
    };
  }, [user, marginalRate, strategy]);

  const loans = user.loans ?? [];
  if (loans.length < 2) return null;

  const indexedLoans = loans
    .map((loan, index) => ({ loan, index }))
    .filter(({ loan }) => Number(loan.outstanding || 0) > 0);
  if (indexedLoans.length < 2) return null;

  const taxRegime = user.country === 'IN' ? user.tax_regime : undefined;
  const legend: LoanLegendEntry[] = indexedLoans.map(({ loan, index }) => {
    const { effective } = computeBreakdown(
      loan,
      marginalRate,
      user.country,
      taxRegime,
      usItemises(user),
    );
    return {
      index,
      label: loan.bank || `Loan #${index + 1}`,
      effectiveRatePct: Number(new Decimal(effective).mul(100).toString()),
    };
  });
  legend.sort((a, b) => (b.effectiveRatePct ?? 0) - (a.effectiveRatePct ?? 0));

  const currency = userDefaultCurrency(user.country);

  return (
    <Card>
      <div>
        <div
          style={{
            fontWeight: 600,
            fontSize: 15,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          Each loan over time
          <InfoTip>
            <strong>What this chart shows.</strong> Each coloured line is one
            of your loans, plotted month-by-month as it pays down. The legend
            lists loans top-to-bottom in the order the engine will attack them.
            <div style={{ marginTop: 8 }}>
              <strong>What to look for.</strong>
            </div>
            <div style={{ marginTop: 4 }}>
              • The top line falls steepest first — that's the loan with the
              highest effective rate getting all your extra surplus.
            </div>
            <div style={{ marginTop: 4 }}>
              • When a line touches zero, the next line's slope gets steeper.
              That's the cascade — surplus rerouting to the next-priority loan.
            </div>
            <div style={{ marginTop: 4 }}>
              • The series stays flat at zero after clearing, not vanishing —
              easier to read.
            </div>
          </InfoTip>
        </div>
        <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
          Avalanche kills the highest-effective-rate loan first. Watch the top
          of the legend collapse fastest — once it clears, the surplus
          cascades and the next line steepens.
        </div>
      </div>
      {error && (
        <div className="muted" style={{ fontSize: 12, marginTop: 12 }}>
          Couldn't load trajectory data: {error}
        </div>
      )}
      {points && (
        <>
          <div style={{ height: 280, marginTop: 12 }}>
            <PerLoanTrajectoryChart
              data={points}
              loans={legend}
              currency={currency}
            />
          </div>
          <PerLoanLegend loans={legend} />
        </>
      )}
      {!points && !error && (
        <div className="muted" style={{ fontSize: 12, marginTop: 12 }}>
          Loading trajectory…
        </div>
      )}
    </Card>
  );
}
