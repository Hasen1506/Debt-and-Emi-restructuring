import { Card } from '@/components/Card';
import { ActionTile } from '@/components/ActionTile';

export default function HomePage() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <section>
        <h1 className="h1">Good evening, Hasen.</h1>
        <p className="muted" style={{ marginTop: 4 }}>
          You're on track. Debt-free by{' '}
          <strong style={{ color: 'var(--ink)' }}>Aug 2027</strong> at your
          current plan.
        </p>
      </section>

      <Card>
        <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>
          This month's action
        </div>
        <div style={{ fontSize: 18, fontWeight: 600 }}>
          Pay <span className="num">₹18,500</span> extra toward your{' '}
          <span style={{ color: 'var(--negative)' }}>ICICI credit card</span>
        </div>
        <div className="muted" style={{ fontSize: 13, marginTop: 6 }}>
          Effective APR{' '}
          <span className="num" style={{ color: 'var(--ink)' }}>
            42.48%
          </span>
          . Clearing this saves you{' '}
          <span className="num" style={{ color: 'var(--positive)' }}>
            ₹31,400
          </span>{' '}
          in interest.
        </div>
      </Card>

      <section>
        <h2 className="h2" style={{ marginBottom: 12 }}>
          Tools
        </h2>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: 12,
          }}
        >
          <ActionTile
            label="Got a bonus?"
            sub="Windfall handler"
            href="/tools/windfall"
          />
          <ActionTile
            label="New EMI?"
            sub="Check before you take"
            href="/tools/new-debt"
          />
          <ActionTile
            label="Sell an asset?"
            sub="Liquidation gate"
            href="/tools/liquidate"
          />
          <ActionTile
            label="Paid extra?"
            sub="Quick recompute"
            href="/tools/recompute"
          />
          <ActionTile
            label="Idle cash?"
            sub="Cash yield check"
            href="/tools/cash-yield"
          />
          <ActionTile
            label="Borrow now?"
            sub="Right-time advisor"
            href="/tools/right-time"
          />
        </div>
      </section>
    </div>
  );
}
