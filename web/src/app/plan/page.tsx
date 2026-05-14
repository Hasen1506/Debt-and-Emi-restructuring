import { Card } from '@/components/Card';
import { DebtTrajectoryChart } from '@/components/DebtTrajectoryChart';
import { api, formatINR, monthIndexToLabel } from '@/lib/api';
import { DEMO_USER, DEMO_MARGINAL_RATE } from '@/lib/demo-user';
import { mergeTrajectories } from '@/lib/trajectory';
import { mockTrajectory, type TrajectoryPoint } from '@/lib/mock-data';

export const dynamic = 'force-dynamic';

async function loadPlan(): Promise<{
  trajectory: TrajectoryPoint[];
  debtFreeMonth: number | null;
  totalInterest: string;
  baselineInterest: string;
  monthsSaved: number;
  live: boolean;
}> {
  try {
    const [avalanche, baseline] = await Promise.all([
      api.simulate({
        user: DEMO_USER,
        strategy: 'avalanche',
        horizon_months: 240,
        marginal_rate: DEMO_MARGINAL_RATE,
      }),
      api.baseline({ user: DEMO_USER, horizon_months: 240 }),
    ]);
    const monthsSaved =
      avalanche.debt_free_month && baseline.debt_free_month
        ? baseline.debt_free_month - avalanche.debt_free_month
        : 0;
    return {
      trajectory: mergeTrajectories(avalanche, baseline),
      debtFreeMonth: avalanche.debt_free_month,
      totalInterest: avalanche.total_interest_paid,
      baselineInterest: baseline.total_interest_paid,
      monthsSaved,
      live: true,
    };
  } catch {
    return {
      trajectory: mockTrajectory,
      debtFreeMonth: null,
      totalInterest: '240000',
      baselineInterest: '410000',
      monthsSaved: 14,
      live: false,
    };
  }
}

export default async function PlanPage() {
  const plan = await loadPlan();
  const surplus =
    Number(DEMO_USER.monthly_income) - Number(DEMO_USER.fixed_expenses);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <section>
        <h1 className="h1">Your debt-free trajectory</h1>
        <p className="muted">
          Avalanche strategy, current surplus{' '}
          <span className="num" style={{ color: 'var(--ink)' }}>
            {formatINR(surplus)}/mo
          </span>
          {!plan.live && (
            <span
              className="chip"
              style={{ marginLeft: 8, color: 'var(--muted)' }}
            >
              offline · sample data
            </span>
          )}
          .
        </p>
      </section>

      <Card>
        <div className="muted" style={{ fontSize: 12 }}>
          Total debt over time (avalanche vs minimums)
        </div>
        <div style={{ height: 320, marginTop: 12 }}>
          <DebtTrajectoryChart data={plan.trajectory} />
        </div>
      </Card>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 12,
        }}
      >
        <Card>
          <div className="muted" style={{ fontSize: 12 }}>
            Debt-free date
          </div>
          <div className="num" style={{ fontSize: 22, fontWeight: 600 }}>
            {monthIndexToLabel(plan.debtFreeMonth)}
          </div>
        </Card>
        <Card>
          <div className="muted" style={{ fontSize: 12 }}>
            Total interest
          </div>
          <div
            className="num"
            style={{
              fontSize: 22,
              fontWeight: 600,
              color: 'var(--positive)',
            }}
          >
            {formatINR(plan.totalInterest)}
          </div>
          <div className="muted" style={{ fontSize: 12 }}>
            vs {formatINR(plan.baselineInterest)} paying minimums
          </div>
        </Card>
        <Card>
          <div className="muted" style={{ fontSize: 12 }}>
            Months saved
          </div>
          <div
            className="num"
            style={{
              fontSize: 22,
              fontWeight: 600,
              color: 'var(--accent)',
            }}
          >
            {plan.monthsSaved}
          </div>
        </Card>
      </div>
    </div>
  );
}
