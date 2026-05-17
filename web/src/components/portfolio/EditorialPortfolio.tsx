import type { Country } from '@/lib/api';
import { formatCurrency } from '@/lib/api';
import {
  assetTypeLabel,
  type PortfolioSummary,
} from './portfolioSummary';

export function EditorialPortfolio({
  summary,
  country,
}: {
  summary: PortfolioSummary;
  country: Country;
}) {
  const ccy = country === 'IN' ? 'INR' : 'USD';
  const fmt = (v: number) => formatCurrency(v.toFixed(0), ccy);

  if (summary.count === 0) {
    return (
      <article style={{ maxWidth: 720, paddingTop: 16 }}>
        <div
          style={{
            fontFamily: 'var(--font-sans)',
            fontSize: 11,
            letterSpacing: '0.15em',
            textTransform: 'uppercase',
            color: 'var(--soft)',
            marginBottom: 12,
          }}
        >
          Holdings · the inventory
        </div>
        <h1
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 400,
            fontSize: 44,
            lineHeight: 1.1,
            letterSpacing: '-0.02em',
            margin: 0,
          }}
        >
          What you own
          <br />
          <em style={{ fontStyle: 'italic', color: 'var(--accent)' }}>
            hasn&apos;t been written down yet.
          </em>
        </h1>
        <p
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 17,
            lineHeight: 1.65,
            marginTop: 22,
            maxWidth: 580,
            color: 'var(--muted)',
            fontStyle: 'italic',
          }}
        >
          Record your FDs, mutual funds, gold, real estate, retirement
          accounts — the picture matters, because{' '}
          <em>Decisions › Liquidate</em> needs to know what&apos;s on the
          table before it ranks what to sell against your debt.
        </p>
        <div style={{ marginTop: 24 }}>
          <a
            href="/onboarding/assets"
            style={{
              display: 'inline-block',
              padding: '10px 18px',
              border: '1px solid var(--ink)',
              background: 'var(--ink)',
              color: 'var(--canvas)',
              textDecoration: 'none',
              fontFamily: 'var(--font-sans)',
              fontSize: 12,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
            }}
          >
            Add a holding
          </a>
        </div>
      </article>
    );
  }

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) 240px',
        gap: 48,
        paddingTop: 16,
      }}
    >
      <article style={{ maxWidth: 760 }}>
        <div
          style={{
            fontFamily: 'var(--font-sans)',
            fontSize: 11,
            letterSpacing: '0.15em',
            textTransform: 'uppercase',
            color: 'var(--soft)',
            marginBottom: 12,
          }}
        >
          Holdings · the inventory
        </div>
        <h1
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 400,
            fontSize: 44,
            lineHeight: 1.1,
            letterSpacing: '-0.02em',
            margin: 0,
          }}
        >
          {summary.count} holdings,
          <br />
          <em style={{ fontStyle: 'italic', color: 'var(--accent)' }}>
            {fmt(summary.totalValue)} on file.
          </em>
        </h1>

        <p
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 17,
            lineHeight: 1.65,
            marginTop: 22,
            maxWidth: 620,
            color: 'var(--muted)',
            fontStyle: 'italic',
          }}
        >
          {summary.topRow && (
            <>
              The heaviest weight is{' '}
              <strong style={{ color: 'var(--ink)' }}>
                {summary.topRow.label}
              </strong>{' '}
              at {fmt(summary.topRow.value)}
              {summary.totalValue > 0 && (
                <>
                  {' '}
                  ({((summary.topRow.value / summary.totalValue) * 100).toFixed(0)}% of the
                  portfolio).
                </>
              )}{' '}
            </>
          )}
          See <em>Decisions › Liquidate</em> for which asset to sell before
          prepaying debt, given tax + lock-in + opportunity cost.
        </p>

        <ol
          style={{
            marginTop: 32,
            paddingLeft: 0,
            listStyle: 'none',
            display: 'flex',
            flexDirection: 'column',
            gap: 0,
          }}
        >
          {summary.rows.map((r, i) => (
            <li
              key={i}
              style={{
                fontFamily: 'var(--font-display)',
                fontSize: 16,
                lineHeight: 1.7,
                borderTop: i === 0 ? '1px solid var(--border)' : 'none',
                borderBottom: '1px solid var(--border)',
                padding: '10px 0',
                display: 'grid',
                gridTemplateColumns: 'auto 1fr auto auto',
                gap: 14,
                alignItems: 'baseline',
              }}
            >
              <span
                style={{
                  fontFamily: 'var(--font-sans)',
                  fontSize: 11,
                  color: 'var(--soft)',
                  letterSpacing: '0.1em',
                }}
              >
                {String(i + 1).padStart(2, '0')}
              </span>
              <span style={{ fontWeight: 500 }}>{r.label}</span>
              <span
                style={{
                  fontFamily: 'var(--font-sans)',
                  fontSize: 11,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  color: 'var(--soft)',
                }}
              >
                {assetTypeLabel(country, r.assetType)}
              </span>
              <span style={{ fontWeight: 600 }}>{fmt(r.value)}</span>
            </li>
          ))}
        </ol>

        <div style={{ marginTop: 36, display: 'flex', flexWrap: 'wrap', gap: 12 }}>
          <a
            href="/onboarding/assets"
            style={{
              padding: '10px 18px',
              border: '1px solid var(--ink)',
              background: 'var(--canvas)',
              color: 'var(--ink)',
              textDecoration: 'none',
              fontFamily: 'var(--font-sans)',
              fontSize: 12,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
            }}
          >
            Edit holdings
          </a>
          <a
            href="/tools/liquidate"
            style={{
              padding: '10px 18px',
              border: '1px solid var(--ink)',
              background: 'var(--ink)',
              color: 'var(--canvas)',
              textDecoration: 'none',
              fontFamily: 'var(--font-sans)',
              fontSize: 12,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
            }}
          >
            Find what to liquidate
          </a>
        </div>
      </article>

      <aside
        style={{
          fontFamily: 'var(--font-sans)',
          fontSize: 11,
          color: 'var(--soft)',
          lineHeight: 1.6,
          paddingTop: 36,
        }}
      >
        <div
          style={{
            textTransform: 'uppercase',
            letterSpacing: '0.15em',
            marginBottom: 14,
            fontSize: 10,
          }}
        >
          By asset class
        </div>
        {summary.byType.map((t) => (
          <div
            key={t.assetType}
            style={{
              borderLeft: '2px solid var(--border)',
              paddingLeft: 12,
              marginBottom: 14,
            }}
          >
            <div
              style={{
                fontFamily: 'var(--font-display)',
                fontSize: 13,
                color: 'var(--ink)',
                fontStyle: 'italic',
                marginBottom: 4,
              }}
            >
              {assetTypeLabel(country, t.assetType)}
            </div>
            <div style={{ color: 'var(--ink)', fontSize: 12 }}>
              {fmt(t.total)} · {t.count} {t.count === 1 ? 'holding' : 'holdings'}
              {summary.totalValue > 0 && (
                <> · {((t.total / summary.totalValue) * 100).toFixed(0)}%</>
              )}
            </div>
          </div>
        ))}
      </aside>
    </div>
  );
}
