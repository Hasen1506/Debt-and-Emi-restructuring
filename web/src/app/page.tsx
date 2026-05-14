'use client';

import { useState } from 'react';
import { Card } from '@/components/Card';
import { ActionTile } from '@/components/ActionTile';

const MAIN_TOOLS = [
  { label: 'Got a bonus?', sub: 'Windfall handler', href: '/tools/windfall' },
  { label: 'Paid extra?', sub: 'Quick recompute', href: '/tools/recompute' },
  { label: 'New EMI?', sub: 'Check before you take', href: '/tools/new-debt' },
] as const;

const MORE_TOOLS = [
  { label: 'Sell an asset?', sub: 'Liquidation gate', href: '/tools/liquidate' },
  { label: 'Idle cash?', sub: 'Cash yield check', href: '/tools/cash-yield' },
  { label: 'Borrow now?', sub: 'Right-time advisor', href: '/tools/right-time' },
  { label: 'NRI prepay vs invest?', sub: 'FX-adjusted decision', href: '/tools/nri-prepay' },
] as const;

export default function HomePage() {
  const [showMore, setShowMore] = useState(false);

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
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            justifyContent: 'space-between',
            marginBottom: 12,
          }}
        >
          <h2 className="h2">Tools</h2>
          <button
            type="button"
            onClick={() => setShowMore((v) => !v)}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--accent)',
              fontSize: 13,
              cursor: 'pointer',
              padding: 4,
            }}
          >
            {showMore ? 'Show less' : `More tools (${MORE_TOOLS.length})…`}
          </button>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: 12,
          }}
        >
          {MAIN_TOOLS.map((t) => (
            <ActionTile key={t.href} label={t.label} sub={t.sub} href={t.href} />
          ))}
        </div>

        {showMore && (
          <>
            <div
              className="muted"
              style={{
                marginTop: 18,
                marginBottom: 8,
                fontSize: 11,
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
              }}
            >
              Less common — surface when the situation comes up
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: 12,
              }}
            >
              {MORE_TOOLS.map((t) => (
                <ActionTile key={t.href} label={t.label} sub={t.sub} href={t.href} />
              ))}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
