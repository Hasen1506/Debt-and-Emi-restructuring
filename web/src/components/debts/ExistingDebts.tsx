'use client';

/**
 * Existing Debts — warm-card layout reading the real saved profile.
 *
 * Each debt gets a Card with bank + type + outstanding + (nominal vs
 * effective) and a "Show breakdown" toggle that opens the shared
 * EffectiveAprBreakdown so the math matches Ledger/Setup. No hardcoded
 * loans.
 */

import { useState } from 'react';
import { Card } from '@/components/Card';
import { EffectiveAprBreakdown } from '@/components/EffectiveAprBreakdown';
import type { StoredProfile } from '@/lib/user-store';
import type { LoanType } from '@/lib/api';
import { formatCurrency } from '@/lib/api';
import { fmt } from '@/lib/effective-apr';
import { deriveMetrics } from '@/lib/derived';
import { loanCurrency, userDefaultCurrency } from '@/lib/currency';
import { LifecycleEventsPanel } from '@/components/lifecycle/LifecycleEventsPanel';

const LOAN_TYPE_LABEL: Record<LoanType, string> = {
  credit_card: 'Credit card',
  personal_loan: 'Personal loan',
  home_loan: 'Home loan',
  auto_loan: 'Auto loan',
  education_loan: 'Education loan',
  gold_loan: 'Gold loan',
  bnpl: 'BNPL',
};

export function ExistingDebts({ profile }: { profile: StoredProfile }) {
  const m = deriveMetrics(profile);
  const { user, marginalRate } = profile;
  const country = user.country;
  const taxRegime = country === 'IN' ? user.tax_regime : undefined;
  const [openIdx, setOpenIdx] = useState<number | null>(null);

  if (m.loans.length === 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <h1 className="h1">Your debts</h1>
        <Card>
          <div className="muted" style={{ fontSize: 13 }}>
            You haven't added any debts yet.{' '}
            <a href="/onboarding?step=loans" style={{ color: 'var(--accent)' }}>
              Add your first debt
            </a>{' '}
            to get started.
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <section>
        <h1 className="h1">Your debts</h1>
        <p className="muted">
          {m.loans.length} active. Total outstanding{' '}
          <strong style={{ color: 'var(--ink)' }}>
            {formatCurrency(m.totalOutstanding.toString(), userDefaultCurrency(country))}
          </strong>{' '}
          · blended effective {fmt(m.blendedEffective)}.
        </p>
      </section>

      {m.loans.map((row) => {
        const isOpen = openIdx === row.index;
        const isLoudest = m.loudest?.index === row.index && row.effective.gt(0.24);
        const spread = row.effective.sub(row.nominal);
        return (
          <Card key={row.index}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                gap: 16,
                flexWrap: 'wrap',
              }}
            >
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 15 }}>
                  {row.loan.bank || 'Unnamed lender'}{' '}
                  <span className="muted" style={{ fontWeight: 400 }}>
                    · {LOAN_TYPE_LABEL[row.loan.loan_type]}
                  </span>
                  {isLoudest && (
                    <span
                      className="chip"
                      style={{
                        marginLeft: 8,
                        color: 'var(--negative)',
                        borderColor: 'var(--negative)',
                      }}
                    >
                      Highest effective APR
                    </span>
                  )}
                </div>
                <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                  Nominal {fmt(row.nominal)}
                  {spread.abs().gt(0.001) && (
                    <>
                      {' · '}
                      <span
                        style={{
                          color: spread.gt(0) ? 'var(--negative)' : 'var(--positive)',
                          fontWeight: 600,
                        }}
                      >
                        {fmt(row.effective)} effective
                      </span>
                    </>
                  )}
                  {row.loan.tenure_months_remaining > 0 && (
                    <> · {row.loan.tenure_months_remaining} months left</>
                  )}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div className="num" style={{ fontSize: 16, fontWeight: 600 }}>
                  {formatCurrency(row.outstanding.toString(), loanCurrency(row.loan, country))}
                </div>
                <button
                  type="button"
                  onClick={() => setOpenIdx(isOpen ? null : row.index)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--accent)',
                    fontSize: 12,
                    cursor: 'pointer',
                    padding: '4px 0 0',
                  }}
                >
                  {isOpen ? 'Hide breakdown' : 'Show breakdown'}
                </button>
              </div>
            </div>
            {isOpen && (
              <div style={{ marginTop: 12 }}>
                <EffectiveAprBreakdown
                  loan={row.loan}
                  marginalTaxRate={marginalRate}
                  country={country}
                  taxRegime={taxRegime}
                  variant="card"
                  incomeType={user.income_type}
                />
              </div>
            )}
          </Card>
        );
      })}

      <a
        href="/onboarding?step=loans"
        className="btn btn-primary"
        style={{ alignSelf: 'flex-start', textDecoration: 'none' }}
      >
        + Add or edit debts
      </a>

      <LifecycleEventsPanel user={profile.user} variant="existing" />
    </div>
  );
}
