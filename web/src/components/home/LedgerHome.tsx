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
import { buildHeadline, buildMarginalia } from '@/lib/letter';
import { EffectiveAprBreakdown } from '@/components/EffectiveAprBreakdown';

const LOAN_TYPE_LABEL: Record<LoanType, string> = {
  credit_card: 'CREDIT CARD',
  personal_loan: 'PERSONAL LOAN',
  home_loan: 'HOME LOAN',
  auto_loan: 'AUTO LOAN',
  education_loan: 'EDUCATION LOAN',
  gold_loan: 'GOLD LOAN',
  bnpl: 'BNPL',
};

// Top 3 quick-actions only — the full tool catalog with descriptions lives
// at /tools. Keeping the home surface tight avoids duplicating the index.
const QUICK_TOOLS = [
  { token: 'WINDFALL', sub: 'BONUS / REFUND / GIFT', href: '/tools/windfall' },
  { token: 'RECOMPUTE', sub: 'PAID EXTRA → REPRICE', href: '/tools/recompute' },
  { token: 'NEW-DEBT', sub: 'PRE-BORROW CHECK', href: '/tools/new-debt' },
] as const;

const LOAN_TYPE_PROSE: Record<LoanType, string> = {
  credit_card: 'credit card',
  personal_loan: 'personal loan',
  home_loan: 'home loan',
  auto_loan: 'auto loan',
  education_loan: 'education loan',
  gold_loan: 'gold loan',
  bnpl: 'BNPL line',
};

const D24 = new Decimal('0.24');

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
        <LedgerLetter
          loudest={m.loudest}
          loans={m.loans}
          surplus={m.surplus}
          blended={m.blendedEffective}
          user={user}
        />
      )}

      <section>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: 11,
            color: 'var(--muted)',
            letterSpacing: '0.18em',
            marginBottom: 6,
            fontFamily: 'var(--font-mono)',
          }}
        >
          <span>$ QUICK ACTIONS</span>
          <a
            href="/tools"
            style={{ color: 'var(--ink)', textDecoration: 'none' }}
          >
            [ALL TOOLS →]
          </a>
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
            gap: 1,
            background: 'var(--ink)',
            padding: 1,
          }}
        >
          {QUICK_TOOLS.map((t) => (
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

function LedgerLetter({
  loudest,
  loans,
  surplus,
  blended,
  user,
}: {
  loudest: LoanWithEffective;
  loans: LoanWithEffective[];
  surplus: Decimal;
  blended: Decimal;
  user: StoredProfile['user'];
}) {
  const headline = buildHeadline(loudest);
  const marginalia = buildMarginalia(loans, blended, user);
  const spread = loudest.effective.sub(loudest.nominal);
  const bigSpread = spread.gt(new Decimal('0.03'));
  const surplusPositive = surplus.gt(0);
  const loudestIsCard = loudest.loan.loan_type === 'credit_card';
  const loudestKind = LOAN_TYPE_PROSE[loudest.loan.loan_type];
  const lender = loudest.loan.bank || 'your highest-rate lender';

  return (
    <section>
      <SectionLabel>$ LETTER · THIS WEEK</SectionLabel>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) 260px',
          gap: 0,
          border: '1px solid var(--ink)',
          background: 'var(--card)',
        }}
      >
        <article
          style={{
            padding: '18px 20px',
            borderRight: '1px solid var(--ink)',
          }}
        >
          <div
            style={{
              fontSize: 22,
              fontWeight: 700,
              lineHeight: 1.2,
              letterSpacing: '-0.01em',
              textTransform: 'uppercase',
            }}
          >
            {headline.prefix}
            <br />
            <span style={{ color: 'var(--accent)' }}>{headline.accent}</span>
          </div>

          <p
            style={{
              fontSize: 13,
              lineHeight: 1.65,
              marginTop: 18,
              color: 'var(--ink)',
            }}
          >
            {bigSpread ? (
              <>
                Your <strong>{lender}</strong> {loudestKind} is the loudest debt
                you own. Nominal {fmt(loudest.nominal)} becomes{' '}
                <strong>{fmt(loudest.effective)}</strong>{' '}
                {loudestIsCard
                  ? 'once GST is folded in'
                  : 'once fees + GST are folded in'}
                , and at a balance of{' '}
                <strong>{formatINR(loudest.outstanding)}</strong> that&apos;s the
                line generating the most friction. Until it&apos;s closer to
                clear, every other move loses to this one.
              </>
            ) : (
              <>
                Your <strong>{lender}</strong> {loudestKind} is currently your
                highest-effective line at{' '}
                <strong>{fmt(loudest.effective)}</strong>. With a balance of{' '}
                <strong>{formatINR(loudest.outstanding)}</strong>, it&apos;s the
                one to chase first — but the spread vs nominal is modest, so
                there&apos;s no fire.
              </>
            )}
          </p>

          <p
            style={{
              fontSize: 13,
              lineHeight: 1.65,
              marginTop: 10,
              color: 'var(--ink)',
            }}
          >
            {surplusPositive ? (
              <>
                Move this month: route the{' '}
                <strong>{formatINR(surplus)}</strong>{' '}
                <abbr title="Surplus = income − fixed expenses − scheduled EMIs. The cash left over each month to deploy against debt above the minimums.">
                  surplus
                </abbr>{' '}
                toward this line on the next salary credit.{' '}
                <a href="/plan" style={{ color: 'var(--accent)' }}>
                  [/plan →]
                </a>{' '}
                shows the full schedule and how much interest that saves over
                the run.
              </>
            ) : (
              <>
                <abbr title="Surplus = income − fixed expenses − scheduled EMIs. The cash left over each month to deploy against debt above the minimums.">
                  Surplus
                </abbr>{' '}
                is{' '}
                <strong style={{ color: 'var(--negative)' }}>
                  {formatINR(surplus)}
                </strong>
                /month — there&apos;s nothing to allocate until you trim fixed
                expenses or re-negotiate an EMI. Until then, prepayment
                isn&apos;t the right move; not falling behind is.
              </>
            )}
          </p>

          <div
            style={{
              marginTop: 18,
              paddingTop: 14,
              borderTop: '1px dashed var(--dash)',
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gap: 16,
            }}
          >
            {[
              {
                v: surplusPositive ? formatINR(surplus) : '—',
                l: surplusPositive ? 'SURPLUS / MO' : 'NO SURPLUS',
                c: surplusPositive ? 'var(--ink)' : 'var(--muted)',
              },
              {
                v: fmt(loudest.effective),
                l: 'EFFECTIVE APR',
                c: loudest.effective.gt(D24) ? 'var(--negative)' : 'var(--ink)',
              },
              {
                v: spread.gt(0) ? `+${fmt(spread)}` : '—',
                l: 'SPREAD VS NOMINAL',
                c: spread.gt(new Decimal('0.05')) ? 'var(--negative)' : 'var(--ink)',
              },
            ].map((s) => (
              <div key={s.l}>
                <div
                  style={{
                    fontSize: 18,
                    fontWeight: 700,
                    color: s.c,
                    letterSpacing: '-0.01em',
                  }}
                >
                  {s.v}
                </div>
                <div
                  style={{
                    fontSize: 10,
                    color: 'var(--muted)',
                    marginTop: 4,
                    letterSpacing: '0.08em',
                  }}
                >
                  {s.l}
                </div>
              </div>
            ))}
          </div>
        </article>

        <aside style={{ padding: '18px 20px' }}>
          <div
            style={{
              fontSize: 10,
              color: 'var(--muted)',
              letterSpacing: '0.18em',
              marginBottom: 12,
            }}
          >
            ALSO WORTH KNOWING
          </div>
          {marginalia.map((n, i) => (
            <div
              key={`${n.date}-${i}`}
              style={{
                marginBottom: 14,
                borderLeft: '2px solid var(--ink)',
                paddingLeft: 10,
              }}
            >
              <div
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: '0.08em',
                  marginBottom: 4,
                  textTransform: 'uppercase',
                }}
              >
                {n.date}
              </div>
              <div
                style={{
                  fontSize: 11,
                  lineHeight: 1.5,
                  color: 'var(--ink)',
                }}
              >
                {n.txt}
              </div>
            </div>
          ))}
        </aside>
      </div>
    </section>
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
