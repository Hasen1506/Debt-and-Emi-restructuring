import { Card } from '@/components/Card';
import { DebtTrajectoryChart } from '@/components/DebtTrajectoryChart';
import { mockTrajectory } from '@/lib/mock-data';

export default function PlanPage() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <section>
        <h1 className="h1">Your debt-free trajectory</h1>
        <p className="muted">
          Avalanche strategy, current surplus{' '}
          <span className="num" style={{ color: 'var(--ink)' }}>
            ₹35,000/mo
          </span>
          .
        </p>
      </section>

      <Card>
        <div className="muted" style={{ fontSize: 12 }}>
          Total debt over time (avalanche vs minimums)
        </div>
        <div style={{ height: 320, marginTop: 12 }}>
          <DebtTrajectoryChart data={mockTrajectory} />
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
            Aug 2027
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
            ₹2.4L
          </div>
          <div className="muted" style={{ fontSize: 12 }}>
            vs ₹4.1L paying minimums
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
            14
          </div>
        </Card>
      </div>
    </div>
  );
}
