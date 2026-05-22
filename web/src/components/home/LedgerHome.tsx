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

import { useMemo } from 'react';
import Decimal from 'decimal.js';
import type { StoredProfile } from '@/lib/user-store';
import type { LoanType } from '@/lib/api';
import { formatCurrency } from '@/lib/api';
import { fmt } from '@/lib/effective-apr';
import { deriveMetrics, type LoanWithEffective } from '@/lib/derived';
import { buildHeadline, buildMarginalia } from '@/lib/letter';
import { loanCurrency, userDefaultCurrency } from '@/lib/currency';
import { LedgerKpiGrid, type LedgerKpiCell } from '@/components/themed/LedgerKpiGrid';

const LOAN_TYPE_LABEL: Record<LoanType, string> = {
  credit_card: 'CREDIT CARD',
  personal_loan: 'PERSONAL LOAN',
  home_loan: 'HOME LOAN',
  auto_loan: 'AUTO LOAN',
  education_loan: 'EDUCATION LOAN',
  gold_loan: 'GOLD LOAN',
  bnpl: 'BNPL',
};

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
  const { user } = profile;

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

  // Portfolio totals are already FX-converted to user residence currency in
  // deriveMetrics, so the user-default formatter is the right one here.
  const userCcy = userDefaultCurrency(profile.user.country);
  const ccy = (d: Decimal) => formatCurrency(d.toString(), userCcy);
  const surplusTone =
    m.surplus.gt(0) ? 'var(--positive)' : m.surplus.lt(0) ? 'var(--negative)' : 'var(--ink)';

  const kpis: LedgerKpiCell[] = [
    {
      label: 'OUTSTANDING',
      value: ccy(m.totalOutstanding),
      sub: `${m.loans.length} OPEN ${m.loans.length === 1 ? 'LINE' : 'LINES'}`,
    },
    {
      label: 'DEBT-FREE',
      value: '→ SEE /PLAN',
      sub: 'NEEDS SIMULATION',
      tone: 'var(--muted)',
    },
    {
      label: 'EFFECTIVE APR',
      value: fmt(m.blendedEffective),
      sub: 'WEIGHTED BY BALANCE',
    },
    {
      label: 'SURPLUS',
      value: `${ccy(m.surplus)}/MO`,
      sub: m.surplus.gt(0) ? 'NET ALLOC' : 'OVER BUDGET',
      tone: surplusTone,
    },
    {
      label: 'LOUDEST',
      value: m.loudest ? `${m.loudest.loan.bank.toUpperCase() || '—'}` : '—',
      sub: m.loudest ? `${fmt(m.loudest.effective)} EFFECTIVE` : '—',
      tone: m.loudest && m.loudest.effective.gt(0.24) ? 'var(--negative)' : undefined,
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
        <SectionLabel>$ SNAPSHOT</SectionLabel>
        <LedgerKpiGrid cells={kpis} valueFontSize={17} valueLetterSpacing="-0.01em" />
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
        <SectionLabel>$ NEXT</SectionLabel>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <a
            href="/plan"
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
            [SEE FULL PLAN &rsaquo;]
          </a>
          <a
            href="/portfolio"
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
            [HOLDINGS]
          </a>
          <a
            href="/goals"
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
            [GOALS]
          </a>
          <a
            href="/decisions"
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
            [DECISIONS]
          </a>
          <a
            href="/tools"
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
            [TOOLS]
          </a>
          <a
            href="/onboarding"
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
            [EDIT PROFILE]
          </a>
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
  const userCcy = userDefaultCurrency(user.country);
  const loudestCcy = loanCurrency(loudest.loan, user.country);
  const fmtLoudest = (v: string | number | Decimal) =>
    formatCurrency(v instanceof Decimal ? v.toString() : v, loudestCcy);
  const fmtUser = (v: string | number | Decimal) =>
    formatCurrency(v instanceof Decimal ? v.toString() : v, userCcy);

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
                <strong>{fmtLoudest(loudest.outstanding)}</strong> that&apos;s the
                line generating the most friction. Until it&apos;s closer to
                clear, every other move loses to this one.
              </>
            ) : (
              <>
                Your <strong>{lender}</strong> {loudestKind} is currently your
                highest-effective line at{' '}
                <strong>{fmt(loudest.effective)}</strong>. With a balance of{' '}
                <strong>{fmtLoudest(loudest.outstanding)}</strong>, it&apos;s the
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
                <strong>{fmtUser(surplus)}</strong>{' '}
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
                  {fmtUser(surplus)}
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
                v: surplusPositive ? fmtUser(surplus) : '—',
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
