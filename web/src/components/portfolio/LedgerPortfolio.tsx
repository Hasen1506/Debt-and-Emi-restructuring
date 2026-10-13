import type { Country, UserPayload } from '@/lib/api';
import { formatCurrency } from '@/lib/api';
import {
  assetTypeLabel,
  type PortfolioSummary,
} from './portfolioSummary';
import { HoldingsTracker } from './HoldingsTracker';
import { CreditCardChips } from './CreditCardChips';
import { LedgerKpiGrid } from '@/components/themed/LedgerKpiGrid';

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 11,
        color: 'var(--muted)',
        letterSpacing: '0.18em',
        marginBottom: 6,
        fontFamily: 'var(--font-mono)',
      }}
    >
      {children}
    </div>
  );
}

export function LedgerPortfolio({
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
  const fmt = (v: number) => formatCurrency(v.toFixed(2), ccy);

  if (summary.count === 0) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 22,
          fontFamily: 'var(--font-mono)',
          fontSize: 12,
          lineHeight: 1.55,
        }}
      >
        <section>
          <SectionLabel>HOLDINGS</SectionLabel>
          <div
            style={{
              background: 'var(--card)',
              border: '1px dashed var(--border)',
              padding: '14px 16px',
              color: 'var(--muted)',
              fontSize: 12,
              lineHeight: 1.6,
            }}
          >
            Nothing on file yet. Add what you own at its value (FDs, funds,
            gold, property, PF), or track shares and funds by ticker below,
            priced for you. Then the Sell to repay calculator can fill in a
            sale from any of them.
            <div style={{ marginTop: 12 }}>
              <a
                href="/profile/assets"
                style={{
                  display: 'inline-block',
                  padding: '8px 14px',
                  border: '1px solid var(--ink)',
                  background: 'var(--ink)',
                  color: 'var(--canvas)',
                  textDecoration: 'none',
                  fontSize: 11,
                  letterSpacing: '0.12em',
                }}
              >
                + ADD WHAT YOU OWN
              </a>
            </div>
          </div>
        </section>
        <HoldingsTracker user={user} marginalRate={marginalRate} variant="ledger" />
      </div>
    );
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 22,
        fontFamily: 'var(--font-mono)',
        fontSize: 12,
        lineHeight: 1.55,
      }}
    >
      <section>
        <SectionLabel>
          HOLDINGS · {summary.count} · {summary.byType.length} TYPES
        </SectionLabel>
        <LedgerKpiGrid
          cells={[
            {
              label: 'TOTAL VALUE',
              value: fmt(summary.totalValue),
              sub: `${summary.count} HOLDINGS`,
            },
            {
              label: 'LARGEST',
              value: summary.topRow ? fmt(summary.topRow.value) : '—',
              sub: summary.topRow?.label ?? '',
            },
            {
              label: 'TOP TYPE',
              value: summary.byType[0]
                ? assetTypeLabel(country, summary.byType[0].assetType).toUpperCase()
                : '—',
              sub: summary.byType[0]
                ? `${((summary.byType[0].total / summary.totalValue) * 100).toFixed(0)}% OF PORTFOLIO`
                : '',
            },
          ]}
        />
      </section>

      <section>
        <SectionLabel>HOLDINGS · LARGEST FIRST</SectionLabel>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr
              style={{
                borderTop: '2px solid var(--ink)',
                borderBottom: '1px solid var(--ink)',
              }}
            >
              {['#', 'LABEL', 'TYPE', 'VALUE', 'SHARE'].map((h, i) => (
                <th
                  key={h}
                  style={{
                    padding: '8px 12px',
                    textAlign: i > 2 ? 'right' : 'left',
                    fontWeight: 700,
                    letterSpacing: '0.08em',
                    fontSize: 10,
                    color: 'var(--muted)',
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {summary.rows.map((r, i) => (
              <tr key={i} style={{ borderBottom: '1px dashed var(--dash)' }}>
                <td style={{ padding: '10px 12px', color: 'var(--muted)' }}>
                  {String(i + 1).padStart(2, '0')}
                </td>
                <td style={{ padding: '10px 12px', fontWeight: 600 }}>{r.label}</td>
                <td
                  style={{
                    padding: '10px 12px',
                    color: 'var(--muted)',
                    fontSize: 11,
                  }}
                >
                  {assetTypeLabel(country, r.assetType).toUpperCase()}
                </td>
                <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 700 }}>
                  {fmt(r.value)}
                </td>
                <td
                  style={{
                    padding: '10px 12px',
                    textAlign: 'right',
                    color: 'var(--muted)',
                  }}
                >
                  {summary.totalValue > 0
                    ? `${((r.value / summary.totalValue) * 100).toFixed(0)}%`
                    : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <HoldingsTracker user={user} marginalRate={marginalRate} variant="ledger" />

      <section>
        <SectionLabel>ACTIONS</SectionLabel>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <a
            href="/profile/assets"
            style={{
              padding: '8px 14px',
              border: '1px solid var(--ink)',
              background: 'var(--canvas)',
              color: 'var(--ink)',
              textDecoration: 'none',
              fontSize: 11,
              letterSpacing: '0.12em',
            }}
          >
            EDIT HOLDINGS
          </a>
          <a
            href="/tools/liquidate"
            style={{
              padding: '8px 14px',
              border: '1px solid var(--ink)',
              background: 'var(--ink)',
              color: 'var(--canvas)',
              textDecoration: 'none',
              fontSize: 11,
              letterSpacing: '0.12em',
            }}
          >
            WORK OUT A SALE AGAINST A LOAN &rsaquo;
          </a>
        </div>
      </section>

      <CreditCardChips user={user} marginalRate={marginalRate} />
    </div>
  );
}
