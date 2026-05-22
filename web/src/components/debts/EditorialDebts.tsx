'use client';

/**
 * Editorial Debts — "The Register".
 *
 * Reads the saved profile and renders each debt as a short serif
 * paragraph: name, tag (loan type + rate type + tenure), nominal vs
 * effective, balance, and a single italic line of consequence written
 * dynamically from the loan's actual numbers. Marginalia surfaces the
 * "loudest line" — whatever debt has the highest effective APR — with
 * a brief justification.
 *
 * Each debt has a "Show breakdown" link that expands the shared
 * EffectiveAprBreakdown component so the math is identical to Setup,
 * Ledger Home, and Ledger Debts.
 */

import { useState } from 'react';
import Decimal from 'decimal.js';
import type { StoredProfile } from '@/lib/user-store';
import type { LoanPayload, LoanType } from '@/lib/api';
import { formatCurrency } from '@/lib/api';
import { fmt } from '@/lib/effective-apr';
import { deriveMetrics, type LoanWithEffective } from '@/lib/derived';
import { EffectiveAprBreakdown } from '@/components/EffectiveAprBreakdown';
import { loanCurrency, userDefaultCurrency } from '@/lib/currency';
import { LifecycleEventsPanel } from '@/components/lifecycle/LifecycleEventsPanel';
import { StaleCardNudge } from '@/components/debts/StaleCardNudge';
import { CashManagementSection } from '@/components/debts/CashManagementSection';
import { TodayCard } from '@/components/debts/TodayCard';

const LOAN_TYPE_LABEL: Record<LoanType, string> = {
  credit_card: 'Revolving credit',
  personal_loan: 'Personal loan',
  home_loan: 'Mortgage',
  auto_loan: 'Auto loan',
  education_loan: 'Education loan',
  gold_loan: 'Gold loan',
  bnpl: 'Pay-later',
};

/** One-line italic note derived from the loan's actual numbers. */
function consequenceLine(row: LoanWithEffective): string {
  const t = row.loan.loan_type;
  const eff = row.effective;
  const spread = eff.sub(row.nominal);
  const bigSpread = spread.gt(new Decimal('0.03'));
  if (t === 'credit_card') {
    if (eff.gt(new Decimal('0.36'))) {
      return 'GST on interest pushes this well past 36% effective. Clear it before anything else, or transfer it.';
    }
    return 'Revolving credit compounds in the worst possible direction. Pay it down ahead of any term loan.';
  }
  if (t === 'home_loan') {
    if (row.loan.rate_type === 'floating') {
      return 'Cheap money. Let it run; the rate moves with the lender benchmark.';
    }
    return 'Long horizon, low rate. Worth keeping while the surplus has higher-return places to go.';
  }
  if (t === 'personal_loan') {
    return 'Steady. The avalanche reaches this once the higher-effective lines clear, then it goes quickly.';
  }
  if (t === 'education_loan') {
    return 'Tax-deductible under 80E; the effective cost is below what the quote suggests.';
  }
  if (t === 'auto_loan') {
    return 'Depreciating collateral, fixed pay-down. Nothing exotic to do here — just hold the schedule.';
  }
  if (t === 'bnpl') {
    return 'Short, sharp, and easy to forget — these add up if you carry more than one.';
  }
  if (bigSpread) {
    return 'The effective rate runs ahead of the headline. Worth a closer look.';
  }
  return 'Quiet. The schedule clears this on its own once higher-effective lines fall.';
}

export function EditorialDebts({ profile }: { profile: StoredProfile }) {
  const m = deriveMetrics(profile);
  const { user, marginalRate } = profile;
  const country = user.country;
  const taxRegime = country === 'IN' ? user.tax_regime : undefined;
  const [openIdx, setOpenIdx] = useState<number | null>(null);

  if (m.loans.length === 0) {
    return (
      <div style={{ paddingTop: 24, maxWidth: 620 }}>
        <h1
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 400,
            fontSize: 36,
            margin: 0,
          }}
        >
          The register is empty.
        </h1>
        <p
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 16,
            marginTop: 18,
            lineHeight: 1.65,
          }}
        >
          Once you've{' '}
          <a
            href="/onboarding?step=loans"
            style={{ color: 'var(--accent)', borderBottom: '1px solid var(--accent)' }}
          >
            added your first debt
          </a>
          , your debts will appear here, each with its own line.
        </p>
      </div>
    );
  }

  const headlineCount = m.loans.length === 1 ? 'one open account' : `${m.loans.length} open accounts`;

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) 240px',
        gap: 48,
        paddingTop: 16,
      }}
    >
      <article style={{ maxWidth: 720 }}>
        <TodayCard user={user} variant="editorial" />
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
          The register · {headlineCount}
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
          What you owe,
          <br />
          <em style={{ fontStyle: 'italic', color: 'var(--accent)' }}>
            and to whom.
          </em>
        </h1>
        <p
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 17,
            lineHeight: 1.65,
            marginTop: 22,
            maxWidth: 620,
          }}
        >
          A line item is more honest than a stack of cards. Total outstanding{' '}
          <strong>{formatCurrency(m.totalOutstanding.toString(), userDefaultCurrency(country))}</strong>
          {m.loudest && m.loudest.effective.gt(new Decimal('0.24')) && (
            <>
              {' '}— most of it ordinary, a sliver of which is on fire.
            </>
          )}
          {(!m.loudest || m.loudest.effective.lte(new Decimal('0.24'))) && (
            <> — blended effective {fmt(m.blendedEffective)}.</>
          )}
        </p>

        <div
          style={{
            marginTop: 36,
            paddingTop: 24,
            borderTop: '1px solid var(--border)',
          }}
        >
          {m.loans.map((row, i) => (
            <DebtParagraph
              key={row.index}
              row={row}
              isLast={i === m.loans.length - 1}
              isLoudest={m.loudest?.index === row.index}
              isOpen={openIdx === row.index}
              onToggle={() => setOpenIdx(openIdx === row.index ? null : row.index)}
              marginalRate={marginalRate}
              country={country}
              taxRegime={taxRegime}
              incomeType={user.income_type}
            />
          ))}
        </div>

        <div style={{ marginTop: 24 }}>
          <a
            href="/onboarding?step=loans"
            style={{
              fontFamily: 'var(--font-sans)',
              fontSize: 13,
              color: 'var(--accent)',
              borderBottom: '1px solid var(--accent)',
              paddingBottom: 2,
              textDecoration: 'none',
            }}
          >
            + Add or edit a line →
          </a>
        </div>

        <StaleCardNudge user={profile.user} variant="editorial" />
        <CashManagementSection profile={profile} variant="editorial" />
        <LifecycleEventsPanel user={profile.user} variant="editorial" />
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
          Tally
        </div>
        <div
          style={{
            borderLeft: '2px solid var(--border)',
            paddingLeft: 12,
            marginBottom: 18,
          }}
        >
          <div
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 22,
              color: 'var(--ink)',
              lineHeight: 1.1,
            }}
          >
            {formatCurrency(m.totalOutstanding.toString(), userDefaultCurrency(country))}
          </div>
          <div style={{ marginTop: 4 }}>total outstanding</div>
        </div>
        <div
          style={{
            borderLeft: '2px solid var(--border)',
            paddingLeft: 12,
            marginBottom: 18,
          }}
        >
          <div
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 22,
              color: 'var(--ink)',
              lineHeight: 1.1,
            }}
          >
            {fmt(m.blendedEffective)}
          </div>
          <div style={{ marginTop: 4 }}>
            blended effective rate, weighted by balance
          </div>
        </div>
        {m.loudest && (
          <div
            style={{
              borderLeft: '2px solid var(--accent)',
              paddingLeft: 12,
              marginBottom: 18,
            }}
          >
            <div
              style={{
                fontFamily: 'var(--font-display)',
                fontSize: 13,
                color: 'var(--accent)',
                fontStyle: 'italic',
                marginBottom: 6,
              }}
            >
              The loudest line
            </div>
            <div style={{ color: 'var(--ink)', fontSize: 12, lineHeight: 1.55 }}>
              {loudestNote(m.loudest, m.totalOutstanding)}
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}

function loudestNote(loudest: LoanWithEffective, total: Decimal): string {
  const pct = total.gt(0)
    ? loudest.outstanding.div(total).mul(100)
    : new Decimal(0);
  const pctStr = pct.lt(new Decimal('0.5')) ? '<1%' : `${pct.toFixed(0)}%`;
  return `The ${loudest.loan.bank || loudest.loan.loan_type} line sits at ${pctStr} of the balance but at ${fmt(loudest.effective)} effective. That's the one to chase.`;
}

function DebtParagraph({
  row,
  isLast,
  isLoudest,
  isOpen,
  onToggle,
  marginalRate,
  country,
  taxRegime,
  incomeType,
}: {
  row: LoanWithEffective;
  isLast: boolean;
  isLoudest: boolean;
  isOpen: boolean;
  onToggle: () => void;
  marginalRate: string;
  country: 'IN' | 'US';
  taxRegime: 'new' | 'old' | undefined;
  incomeType: 'salaried' | 'business_owner';
}) {
  const tag = [
    LOAN_TYPE_LABEL[row.loan.loan_type],
    row.loan.rate_type === 'floating' ? 'floating' : 'fixed',
  ]
    .filter(Boolean)
    .join(' · ');
  const tenure =
    row.loan.tenure_months_remaining > 0
      ? `${row.loan.tenure_months_remaining} months remaining`
      : 'no fixed end';
  const isAccent = isLoudest && row.effective.gt(new Decimal('0.24'));
  const name = row.loan.bank || 'Unnamed lender';

  return (
    <div
      style={{
        paddingBottom: 24,
        marginBottom: 24,
        borderBottom: isLast ? 'none' : '1px solid var(--border)',
      }}
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr auto',
          gap: 18,
          alignItems: 'baseline',
          marginBottom: 8,
        }}
      >
        <div>
          <div
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 22,
              fontWeight: 500,
              color: isAccent ? 'var(--accent)' : 'var(--ink)',
            }}
          >
            {name}
          </div>
          <div
            style={{
              fontFamily: 'var(--font-sans)',
              fontSize: 11,
              color: 'var(--soft)',
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              marginTop: 4,
            }}
          >
            {tag} · {tenure}
          </div>
        </div>
        <div
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 22,
            fontWeight: 500,
            textAlign: 'right',
          }}
        >
          {formatCurrency(row.outstanding.toString(), loanCurrency(row.loan, country))}
        </div>
      </div>
      <div
        style={{
          display: 'flex',
          gap: 24,
          fontFamily: 'var(--font-sans)',
          fontSize: 12,
          color: 'var(--muted)',
          marginBottom: 10,
          flexWrap: 'wrap',
        }}
      >
        <span>
          Nominal{' '}
          <span className="num" style={{ color: 'var(--ink)', marginLeft: 4 }}>
            {fmt(row.nominal)}
          </span>
        </span>
        <span>
          Effective{' '}
          <span
            className="num"
            style={{
              color: isAccent ? 'var(--accent)' : 'var(--ink)',
              marginLeft: 4,
              fontWeight: isAccent ? 600 : 400,
            }}
          >
            {fmt(row.effective)}
          </span>
        </span>
        <button
          type="button"
          onClick={onToggle}
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--accent)',
            fontFamily: 'var(--font-sans)',
            fontSize: 12,
            cursor: 'pointer',
            padding: 0,
            textDecoration: isOpen ? 'none' : 'underline',
          }}
        >
          {isOpen ? 'Hide breakdown' : 'Show breakdown'}
        </button>
      </div>
      <p
        style={{
          fontFamily: 'var(--font-display)',
          fontSize: 15,
          lineHeight: 1.6,
          color: 'var(--ink)',
          fontStyle: 'italic',
        }}
      >
        {consequenceLine(row)}
      </p>
      {isOpen && (
        <div style={{ marginTop: 14 }}>
          <EffectiveAprBreakdown
            loan={row.loan as LoanPayload}
            marginalTaxRate={marginalRate}
            country={country}
            taxRegime={taxRegime}
            variant="card"
            incomeType={incomeType}
          />
        </div>
      )}
    </div>
  );
}
