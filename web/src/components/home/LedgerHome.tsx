'use client';

/**
 * Ledger Home — bank-statement dashboard.
 *
 * Reads the user's saved profile (passed in by the server page) and
 * derives every visible number — outstanding totals, blended effective
 * APR, surplus, and the loudest debt — using lib/derived.ts. No
 * hardcoded loans. The DEBT-FREE KPI defers to /plan because computing
 * it accurately needs the simulation engine.
 */

import { useMemo, useState } from 'react';
import Decimal from 'decimal.js';
import type { StoredProfile } from '@/lib/user-store';
import type { LoanType } from '@/lib/api';
import { formatINR } from '@/lib/api';
import { fmt } from '@/lib/effective-apr';
import { deriveMetrics, type LoanWithEffective } from '@/lib/derived';
import { EffectiveAprBreakdown } from '@/components/EffectiveAprBreakdown';

const LOAN_TYPE_LABEL: Record<LoanType, string> = {
  credit_card: 'CARD',
  personal_loan: 'PERS LOAN',
  home_loan: 'HOME',
  auto_loan: 'AUTO',
  education_loan: 'EDU',
  gold_loan: 'GOLD',
  bnpl: 'BNPL',
};

const TOOLS = [
  { token: 'WINDFALL', sub: 'BONUS / REFUND / GIFT', href: '/tools/windfall' },
  { token: 'RECOMPUTE', sub: 'PAID EXTRA → REPRICE', href: '/tools/recompute' },
  { token: 'NEW-DEBT', sub: 'PRE-BORROW CHECK', href: '/tools/new-debt' },
  { token: 'LIQUIDATE', sub: 'SELL ASSET → CLEAR DEBT', href: '/tools/liquidate' },
  { token: 'CASH-YIELD', sub: 'IDLE CASH AUDIT', href: '/tools/cash-yield' },
  { token: 'RIGHT-TIME', sub: 'BORROW NOW Y/N', href: '/tools/right-time' },
  { token: 'NRI-PREPAY', sub: 'FX-ADJUSTED DECISION', href: '/tools/nri-prepay' },
] as const;

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

export function LedgerHome({ profile }: { profile: StoredProfile }) {
  const m = useMemo(() => deriveMetrics(profile), [profile]);
  const { user, marginalRate } = profile;
  const country = user.country;
  const taxRegime = country === 'IN' ? user.tax_regime : undefined;
  const [expanded, setExpanded] = useState<number | null>(null);

  if (m.loans.length === 0) {
    return (
      <div
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 12,
          padding: 24,
          border: '1px dashed var(--border)',
        }}
      >
        $ STATUS · NO DEBTS ON FILE
        <br />
        <br />
        Run setup to add your debts:{' '}
        <a href="/onboarding" style={{ color: 'var(--accent)' }}>
          [SETUP →]
        </a>
      </div>
    );
  }

  const ccy = (d: Decimal) => formatINR(d);
  const surplusTone =
    m.surplus.gt(0) ? 'var(--positive)' : m.surplus.lt(0) ? 'var(--negative)' : 'var(--ink)';

  const kpis = [
    {
      l: 'OUTSTANDING',
      v: ccy(m.totalOutstanding),
      s: `${m.loans.length} OPEN ${m.loans.length === 1 ? 'LINE' : 'LINES'}`,
      tone: 'var(--ink)',
    },
    {
      l: 'DEBT-FREE',
      v: '→ SEE /PLAN',
      s: 'NEEDS SIMULATION',
      tone: 'var(--muted)',
    },
    {
      l: 'EFFECTIVE APR',
      v: fmt(m.blendedEffective),
      s: 'WEIGHTED BY BALANCE',
      tone: 'var(--ink)',
    },
    {
      l: 'SURPLUS',
      v: `${ccy(m.surplus)}/MO`,
      s: m.surplus.gt(0) ? 'NET ALLOC' : 'OVER BUDGET',
      tone: surplusTone,
    },
    {
      l: 'LOUDEST',
      v: m.loudest ? `${m.loudest.loan.bank.toUpperCase() || '—'}` : '—',
      s: m.loudest ? `${fmt(m.loudest.effective)} EFFECTIVE` : '—',
      tone: m.loudest && m.loudest.effective.gt(0.24) ? 'var(--negative)' : 'var(--ink)',
    },
  ];

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
        <SectionLabel>$ STATUS</SectionLabel>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(5, 1fr)',
            gap: 1,
            background: 'var(--ink)',
            padding: 1,
          }}
        >
          {kpis.map((k) => (
            <div
              key={k.l}
              style={{ background: 'var(--canvas)', padding: '10px 12px' }}
            >
              <div
                style={{
                  fontSize: 10,
                  color: 'var(--muted)',
                  letterSpacing: '0.12em',
                  marginBottom: 4,
                }}
              >
                {k.l}
              </div>
              <div
                style={{
                  fontSize: 17,
                  fontWeight: 700,
                  color: k.tone,
                  letterSpacing: '-0.01em',
                }}
              >
                {k.v}
              </div>
              <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 4 }}>
                {k.s}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: 11,
            color: 'var(--muted)',
            letterSpacing: '0.18em',
            marginBottom: 6,
          }}
        >
          <span>$ OPEN POSITIONS · {m.loans.length}</span>
          <a href="/onboarding" style={{ color: 'var(--ink)', textDecoration: 'none' }}>
            [↻ EDIT]
          </a>
        </div>
        <table
          style={{
            width: '100%',
            borderCollapse: 'collapse',
            fontSize: 12,
          }}
        >
          <thead>
            <tr
              style={{
                borderTop: '2px solid var(--ink)',
                borderBottom: '1px solid var(--ink)',
              }}
            >
              {['#', 'LENDER', 'TYPE', 'NOMINAL', 'EFFECTIVE', 'OUTSTANDING', 'EMI', 'TENURE', ''].map(
                (h, i) => (
                  <th
                    key={h || `c${i}`}
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
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {m.loans.map((row) => (
              <PositionRow
                key={row.index}
                row={row}
                expanded={expanded === row.index}
                onToggle={() => setExpanded(expanded === row.index ? null : row.index)}
                marginalRate={marginalRate}
                country={country}
                taxRegime={taxRegime}
                loudestIdx={m.loudest?.index ?? -1}
              />
            ))}
            <tr style={{ borderTop: '2px solid var(--ink)' }}>
              <td colSpan={5} style={{ padding: '10px 12px', fontWeight: 700 }}>
                TOTAL
              </td>
              <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 700 }}>
                {ccy(m.totalOutstanding)}
              </td>
              <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 700 }}>
                {ccy(m.emiBurden)}/mo
              </td>
              <td colSpan={2}></td>
            </tr>
          </tbody>
        </table>
      </section>

      {m.loudest && (
        <section>
          <SectionLabel>$ DECISION · ALLOCATE SURPLUS</SectionLabel>
          <div
            style={{
              border: '1px solid var(--ink)',
              padding: '14px 16px',
              background: 'var(--card)',
            }}
          >
            <div
              style={{
                fontSize: 11,
                color: 'var(--muted)',
                letterSpacing: '0.12em',
                marginBottom: 6,
              }}
            >
              HIGHEST EFFECTIVE APR →
            </div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>
              {m.surplus.gt(0)
                ? `PAY ${ccy(m.surplus)} EXTRA TO ${m.loudest.loan.bank.toUpperCase()}`
                : `CLEAR ${m.loudest.loan.bank.toUpperCase()} FIRST`}
            </div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 6 }}>
              {m.loudest.loan.bank} · {LOAN_TYPE_LABEL[m.loudest.loan.loan_type]} ·{' '}
              {fmt(m.loudest.effective)} effective ·{' '}
              {ccy(m.loudest.outstanding)} outstanding.{' '}
              {m.surplus.gt(0) ? (
                <>See /plan for the full schedule.</>
              ) : (
                <>Surplus is negative — review fixed expenses or scheduled EMIs.</>
              )}
            </div>
          </div>
        </section>
      )}

      <section>
        <SectionLabel>$ TOOLS</SectionLabel>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
            gap: 1,
            background: 'var(--ink)',
            padding: 1,
          }}
        >
          {TOOLS.map((t) => (
            <a
              key={t.token}
              href={t.href}
              style={{
                background: 'var(--canvas)',
                padding: '10px 12px',
                textDecoration: 'none',
                color: 'var(--ink)',
                display: 'block',
              }}
            >
              <div style={{ fontSize: 12, fontWeight: 700 }}>[{t.token}]</div>
              <div
                style={{
                  fontSize: 10,
                  color: 'var(--muted)',
                  marginTop: 4,
                  letterSpacing: '0.06em',
                }}
              >
                {t.sub}
              </div>
            </a>
          ))}
        </div>
      </section>
    </div>
  );
}

function PositionRow({
  row,
  expanded,
  onToggle,
  marginalRate,
  country,
  taxRegime,
  loudestIdx,
}: {
  row: LoanWithEffective;
  expanded: boolean;
  onToggle: () => void;
  marginalRate: string;
  country: 'IN' | 'US';
  taxRegime: 'new' | 'old' | undefined;
  loudestIdx: number;
}) {
  const hl = row.index === loudestIdx && row.effective.gt(0.24);
  const tenure =
    row.loan.tenure_months_remaining > 0 ? `${row.loan.tenure_months_remaining} mo` : '—';
  const emi =
    Number(row.loan.scheduled_emi) > 0 ? formatINR(row.loan.scheduled_emi) : '—';

  return (
    <>
      <tr
        style={{
          borderBottom: expanded ? 'none' : '1px dashed var(--dash)',
          background: hl ? '#fff3a3' : 'transparent',
        }}
      >
        <td style={{ padding: '10px 12px', color: 'var(--muted)' }}>
          {String(row.index + 1).padStart(2, '0')}
        </td>
        <td style={{ padding: '10px 12px', fontWeight: 700 }}>
          {row.loan.bank || '—'}
        </td>
        <td style={{ padding: '10px 12px', color: 'var(--muted)' }}>
          {LOAN_TYPE_LABEL[row.loan.loan_type]}
        </td>
        <td style={{ padding: '10px 12px', textAlign: 'right' }}>{fmt(row.nominal)}</td>
        <td
          style={{
            padding: '10px 12px',
            textAlign: 'right',
            color: hl ? 'var(--negative)' : 'var(--ink)',
            fontWeight: hl ? 700 : 400,
          }}
        >
          {fmt(row.effective)}
        </td>
        <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 700 }}>
          {formatINR(row.loan.outstanding || '0')}
        </td>
        <td style={{ padding: '10px 12px', textAlign: 'right' }}>{emi}</td>
        <td
          style={{
            padding: '10px 12px',
            textAlign: 'right',
            color: 'var(--muted)',
          }}
        >
          {tenure}
        </td>
        <td style={{ padding: '10px 12px', textAlign: 'right' }}>
          <button
            type="button"
            onClick={onToggle}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--ink)',
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              letterSpacing: '0.08em',
              cursor: 'pointer',
              padding: 0,
            }}
          >
            {expanded ? '[CLOSE]' : '[BREAKDOWN]'}
          </button>
        </td>
      </tr>
      {expanded && (
        <tr style={{ borderBottom: '1px dashed var(--dash)' }}>
          <td colSpan={9} style={{ padding: '0 12px 14px' }}>
            <EffectiveAprBreakdown
              loan={row.loan}
              marginalTaxRate={marginalRate}
              country={country}
              taxRegime={taxRegime}
              variant="card"
            />
          </td>
        </tr>
      )}
    </>
  );
}
