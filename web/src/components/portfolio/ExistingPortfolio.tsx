import { Card } from '@/components/Card';
import type { Country, UserPayload } from '@/lib/api';
import { formatCurrency } from '@/lib/api';
import {
  assetTypeLabel,
  type PortfolioSummary,
} from './portfolioSummary';
import { HoldingsTracker } from './HoldingsTracker';

export function ExistingPortfolio({
  summary,
  country,
  user,
  marginalRate,
}: {
  summary: PortfolioSummary;
  country: Country;
  user: UserPayload;
  marginalRate: string;
}) {
  const ccy = country === 'IN' ? 'INR' : 'USD';
  const fmt = (v: number) => formatCurrency(v.toFixed(0), ccy);

  if (summary.count === 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <section>
          <h1 className="h1">Portfolio</h1>
          <p className="muted">
            What you own — FDs, mutual funds, gold, real estate, retirement
            accounts. Tools &rsaquo; Liquidate ranks which to sell against
            high-rate debt; without holdings on file, that advisor can&apos;t
            do its job.
          </p>
        </section>
        <HoldingsTracker user={user} marginalRate={marginalRate} variant="existing" />
        <Card>
          <div className="muted" style={{ marginBottom: 12 }}>
            Got non-equity holdings (FD, gold, real estate, retirement)? Use
            the full wizard.
          </div>
          <a
            href="/onboarding/assets"
            className="btn btn-primary"
            style={{ display: 'inline-block', textDecoration: 'none' }}
          >
            + Add a holding
          </a>
        </Card>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <section>
        <h1 className="h1">Portfolio</h1>
        <p className="muted">
          {summary.count} holdings totalling {fmt(summary.totalValue)}.
          {summary.topRow && (
            <>
              {' '}Heaviest weight: <strong>{summary.topRow.label}</strong> at{' '}
              {fmt(summary.topRow.value)}
              {summary.totalValue > 0 && (
                <>
                  {' '}
                  ({((summary.topRow.value / summary.totalValue) * 100).toFixed(0)}%).
                </>
              )}
            </>
          )}
        </p>
      </section>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 12,
        }}
      >
        <Card>
          <div className="muted" style={{ fontSize: 12 }}>
            Total value
          </div>
          <div className="num" style={{ fontSize: 22, fontWeight: 600 }}>
            {fmt(summary.totalValue)}
          </div>
          <div className="muted" style={{ fontSize: 12 }}>
            across {summary.count} {summary.count === 1 ? 'holding' : 'holdings'}
          </div>
        </Card>
        <Card>
          <div className="muted" style={{ fontSize: 12 }}>
            Largest holding
          </div>
          <div className="num" style={{ fontSize: 22, fontWeight: 600 }}>
            {summary.topRow ? fmt(summary.topRow.value) : '—'}
          </div>
          <div className="muted" style={{ fontSize: 12 }}>
            {summary.topRow?.label ?? ''}
          </div>
        </Card>
        <Card>
          <div className="muted" style={{ fontSize: 12 }}>
            Asset classes
          </div>
          <div className="num" style={{ fontSize: 22, fontWeight: 600 }}>
            {summary.byType.length}
          </div>
          <div className="muted" style={{ fontSize: 12 }}>
            {summary.byType[0]
              ? `${assetTypeLabel(country, summary.byType[0].assetType)} leads`
              : ''}
          </div>
        </Card>
      </div>

      <Card>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div className="muted" style={{ fontSize: 12 }}>
            Holdings, ranked by current value
          </div>
          {summary.rows.map((r, i) => (
            <div
              key={i}
              style={{
                display: 'grid',
                gridTemplateColumns: '32px 1fr auto auto',
                gap: 12,
                alignItems: 'center',
                padding: '10px 0',
                borderTop: i === 0 ? '1px solid var(--border)' : '1px solid var(--border)',
              }}
            >
              <span className="muted">{String(i + 1).padStart(2, '0')}</span>
              <div>
                <div style={{ fontWeight: 500 }}>{r.label}</div>
                <div className="muted" style={{ fontSize: 12 }}>
                  {assetTypeLabel(country, r.assetType)}
                </div>
              </div>
              <span className="num" style={{ fontWeight: 600 }}>
                {fmt(r.value)}
              </span>
              <span className="muted" style={{ fontSize: 12 }}>
                {summary.totalValue > 0
                  ? `${((r.value / summary.totalValue) * 100).toFixed(0)}%`
                  : ''}
              </span>
            </div>
          ))}
        </div>
      </Card>

      <HoldingsTracker user={user} marginalRate={marginalRate} variant="existing" />

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
        <a
          href="/onboarding/assets"
          className="btn"
          style={{ textDecoration: 'none' }}
        >
          Edit holdings
        </a>
        <a
          href="/tools/liquidate"
          className="btn btn-primary"
          style={{ textDecoration: 'none' }}
        >
          Find what to liquidate →
        </a>
      </div>
    </div>
  );
}
