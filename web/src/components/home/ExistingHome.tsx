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
import { ActionTile } from '@/components/ActionTile';
import type { StoredProfile } from '@/lib/user-store';
import type { LoanType } from '@/lib/api';
import { formatINR } from '@/lib/api';
import { fmt } from '@/lib/effective-apr';
import { deriveMetrics } from '@/lib/derived';

const LOAN_TYPE_LABEL: Record<LoanType, string> = {
  credit_card: 'credit card',
  personal_loan: 'personal loan',
  home_loan: 'home loan',
  auto_loan: 'auto loan',
  education_loan: 'education loan',
  gold_loan: 'gold loan',
  bnpl: 'BNPL line',
};

// Quick-actions only — the full tool catalog with descriptions lives at
// /tools. Keeping this home surface tight avoids duplicating the index.
const QUICK_TOOLS = [
  { label: 'Got a bonus?', sub: 'Windfall handler', href: '/tools/windfall' },
  { label: 'Paid extra?', sub: 'Quick recompute', href: '/tools/recompute' },
  { label: 'New EMI?', sub: 'Check before you take', href: '/tools/new-debt' },
] as const;

export function ExistingHome({ profile }: { profile: StoredProfile }) {
  const m = deriveMetrics(profile);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <section>
        <h1 className="h1">Welcome back.</h1>
        {m.loans.length > 0 ? (
          <p className="muted" style={{ marginTop: 4 }}>
            {m.loans.length} debt{m.loans.length > 1 ? 's' : ''} on file ·
            total outstanding{' '}
            <strong style={{ color: 'var(--ink)' }}>
              {formatINR(m.totalOutstanding)}
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
                <span className="num">{formatINR(m.surplus)}</span> extra toward
                your{' '}
                <span style={{ color: 'var(--negative)' }}>
                  {m.loudest.loan.bank || 'highest-rate'}{' '}
                  {LOAN_TYPE_LABEL[m.loudest.loan.loan_type]}
                </span>
              </div>
              <div className="muted" style={{ fontSize: 13, marginTop: 6 }}>
                Effective APR{' '}
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
                Surplus is{' '}
                <span style={{ color: 'var(--negative)' }}>
                  {formatINR(m.surplus)}/month
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

      <section>
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            justifyContent: 'space-between',
            marginBottom: 12,
          }}
        >
          <h2 className="h2">Quick actions</h2>
          <a
            href="/tools"
            style={{ color: 'var(--accent)', fontSize: 13 }}
          >
            All tools →
          </a>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: 12,
          }}
        >
          {QUICK_TOOLS.map((t) => (
            <ActionTile key={t.href} label={t.label} sub={t.sub} href={t.href} />
          ))}
        </div>
      </section>
    </div>
  );
}
