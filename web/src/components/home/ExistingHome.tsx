'use client';

/**
 * Existing Home — warm-card dashboard reading the real saved profile.
 *
 * "This month's action" card replaces the previous hardcoded ICICI / 42.48%
 * / ₹31,400 demo with a derived recommendation: send the surplus toward the
 * highest-effective-APR debt, or — if surplus is negative — flag that
 * instead.
 */

import { Card } from '@/components/Card';
import type { StoredProfile } from '@/lib/user-store';
import type { LoanType } from '@/lib/api';
import { formatCurrency } from '@/lib/api';
import { fmt } from '@/lib/effective-apr';
import { deriveMetrics } from '@/lib/derived';
import { userDefaultCurrency } from '@/lib/currency';

const LOAN_TYPE_LABEL: Record<LoanType, string> = {
  credit_card: 'credit card',
  personal_loan: 'personal loan',
  home_loan: 'home loan',
  auto_loan: 'auto loan',
  education_loan: 'education loan',
  gold_loan: 'gold loan',
  bnpl: 'BNPL line',
};

export function ExistingHome({ profile }: { profile: StoredProfile }) {
  const m = deriveMetrics(profile);
  // Portfolio totals are already FX-converted into the user's residence
  // currency inside `deriveMetrics`, so the user-default formatter is
  // the right one here.
  const ccy = userDefaultCurrency(profile.user.country);
  const moneyFmt = (v: string | number | { toString(): string }) =>
    formatCurrency(typeof v === 'object' ? v.toString() : v, ccy);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <section>
        <h1 className="h1">Snapshot</h1>
        {m.loans.length > 0 ? (
          <p className="muted" style={{ marginTop: 4 }}>
            {m.loans.length} debt{m.loans.length > 1 ? 's' : ''} on file ·
            total outstanding{' '}
            <strong style={{ color: 'var(--ink)' }}>
              {moneyFmt(m.totalOutstanding)}
            </strong>{' '}
            · blended {fmt(m.blendedEffective)} effective.
          </p>
        ) : (
          <p className="muted" style={{ marginTop: 4 }}>
            No debts on file yet —{' '}
            <a href="/onboarding" style={{ color: 'var(--accent)' }}>
              run setup
            </a>{' '}
            to get started.
          </p>
        )}
      </section>

      {m.loudest && (
        <Card>
          <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>
            This month's action
          </div>
          {m.surplus.gt(0) ? (
            <>
              <div style={{ fontSize: 18, fontWeight: 600 }}>
                Pay{' '}
                <span className="num">{moneyFmt(m.surplus)}</span> extra toward
                your{' '}
                <span style={{ color: 'var(--negative)' }}>
                  {m.loudest.loan.bank || 'highest-rate'}{' '}
                  {LOAN_TYPE_LABEL[m.loudest.loan.loan_type]}
                </span>
              </div>
              <div className="muted" style={{ fontSize: 13, marginTop: 6 }}>
                <abbr title="Effective APR = nominal rate minus tax shield (Sec 80EEA / 24b / IRC §163), plus amortised fees. The real cost of the debt to you.">
                  Effective APR
                </abbr>{' '}
                <span className="num" style={{ color: 'var(--ink)' }}>
                  {fmt(m.loudest.effective)}
                </span>{' '}
                — the highest of your {m.loans.length} debt
                {m.loans.length > 1 ? 's' : ''}.{' '}
                <a href="/plan" style={{ color: 'var(--accent)' }}>
                  See the full schedule →
                </a>
              </div>
            </>
          ) : (
            <>
              <div style={{ fontSize: 18, fontWeight: 600 }}>
                <abbr title="Surplus = income − fixed expenses − scheduled EMIs. The cash left over each month to deploy against debt above the minimums.">
                  Surplus
                </abbr>{' '}
                is{' '}
                <span style={{ color: 'var(--negative)' }}>
                  {moneyFmt(m.surplus)}/month
                </span>{' '}
                — review fixed expenses or scheduled EMIs.
              </div>
              <div className="muted" style={{ fontSize: 13, marginTop: 6 }}>
                Once positive, the engine will allocate it toward{' '}
                {m.loudest.loan.bank || 'your highest-effective'}{' '}
                {LOAN_TYPE_LABEL[m.loudest.loan.loan_type]} (
                {fmt(m.loudest.effective)} effective).
              </div>
            </>
          )}
        </Card>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
        <a
          href="/plan"
          className="btn btn-primary"
          style={{ textDecoration: 'none' }}
        >
          See your full plan →
        </a>
        <a
          href="/portfolio"
          className="btn"
          style={{ textDecoration: 'none' }}
        >
          Holdings
        </a>
        <a
          href="/tools"
          className="btn"
          style={{ textDecoration: 'none' }}
        >
          Tools
        </a>
        <a
          href="/onboarding"
          className="btn"
          style={{ textDecoration: 'none' }}
        >
          Edit profile
        </a>
      </div>
    </div>
  );
}
