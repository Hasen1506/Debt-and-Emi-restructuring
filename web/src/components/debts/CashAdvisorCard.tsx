'use client';

/**
 * Cash-vs-debt advisor card — Phase 5 of the cash module.
 *
 * Renders only when computeCashAdvice() finds a real opportunity:
 *   • user has cash_accounts populated
 *   • at least one active loan
 *   • eligible cash above the sacred floor (≥ MIN_EXCESS)
 *   • loudest debt's effective APR beats the post-tax cash APY by ≥ 2pp
 *
 * Once those gates pass, the card shows the concrete move with the math:
 *   "Move ₹X from <lowest-APY account> to <loudest bank>.
 *    Saves ₹Y / year. Floor of ₹Z preserved."
 *
 * Three skin variants matching the other /debts cards.
 */

import { useEffect, useMemo, useState } from 'react';
import type { StoredProfile } from '@/lib/user-store';
import { formatCurrency } from '@/lib/api';
import { fmt } from '@/lib/effective-apr';
import { userDefaultCurrency } from '@/lib/currency';
import { computeCashAdvice, lowestApySource } from '@/lib/cash-advisor';

type Variant = 'ledger' | 'editorial' | 'existing';

const LOAN_TYPE_LABEL: Record<string, string> = {
  credit_card: 'credit card',
  personal_loan: 'personal loan',
  home_loan: 'home loan',
  auto_loan: 'auto loan',
  education_loan: 'education loan',
  gold_loan: 'gold loan',
  bnpl: 'BNPL',
};

export function CashAdvisorCard({
  profile,
  variant,
}: {
  profile: StoredProfile;
  variant: Variant;
}) {
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);

  const advice = useMemo(
    () => computeCashAdvice(profile.user, profile.marginalRate),
    [profile.user, profile.marginalRate],
  );
  const source = useMemo(
    () => lowestApySource(profile.user.cash_accounts),
    [profile.user.cash_accounts],
  );

  if (!ready) return null;
  if (!advice || !source) return null;

  const currency = userDefaultCurrency(profile.user.country);
  const isCard = advice.loudest.loan.loan_type === 'credit_card';
  const loanLabel =
    LOAN_TYPE_LABEL[advice.loudest.loan.loan_type] ?? 'loan';

  const headline = (
    <>
      Move{' '}
      <strong>{formatCurrency(advice.excess.toString(), currency)}</strong> from{' '}
      <strong>{source.name}</strong> to{' '}
      <strong>{advice.loudest.loan.bank || 'top-rate debt'}</strong>{' '}
      {loanLabel}. Saves about{' '}
      <strong style={{ color: 'var(--positive)' }}>
        {formatCurrency(advice.annualSaving.toString(), currency)}/year
      </strong>{' '}
      in interest.
    </>
  );

  const detail = (
    <div className="muted" style={{ fontSize: 12, lineHeight: 1.55, marginTop: 6 }}>
      <div>
        Cash post-tax yield ~{fmt(advice.postTaxApy)} vs. {loanLabel} effective{' '}
        {fmt(advice.loudest.effective)} — {fmt(advice.spread)} spread.
      </div>
      <div style={{ marginTop: 4 }}>
        Sacred floor preserved:{' '}
        <strong style={{ color: 'var(--ink)' }}>
          {formatCurrency(advice.sacredFloor.toString(), currency)}
        </strong>{' '}
        — that's 1 month of expenses plus your EF target. The recommendation
        only touches cash above that line.
      </div>
      {isCard && (
        <div style={{ marginTop: 6 }}>
          <strong style={{ color: 'var(--ink)' }}>Watch the rebound:</strong> a
          cleared card is often re-spent within months. Consider lowering the
          limit or freezing it after paying down.
        </div>
      )}
    </div>
  );

  if (variant === 'ledger') {
    return (
      <div
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 12,
          lineHeight: 1.55,
          borderLeft: '3px solid var(--positive)',
          paddingLeft: 12,
          marginBottom: 14,
        }}
      >
        <div
          style={{
            fontSize: 11,
            color: 'var(--positive)',
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
          }}
        >
          $ ADVISOR · CASH → DEBT
        </div>
        <div style={{ marginTop: 6 }}>{headline}</div>
        {detail}
      </div>
    );
  }
  if (variant === 'editorial') {
    return (
      <div
        style={{
          margin: '14px 0 18px',
          paddingLeft: 14,
          borderLeft: '3px solid var(--positive)',
        }}
      >
        <div
          style={{
            fontFamily: 'var(--font-sans)',
            fontSize: 11,
            letterSpacing: '0.15em',
            textTransform: 'uppercase',
            color: 'var(--positive)',
          }}
        >
          Cash advisor
        </div>
        <div style={{ marginTop: 6, fontSize: 14, lineHeight: 1.5 }}>{headline}</div>
        {detail}
      </div>
    );
  }
  return (
    <div
      style={{
        padding: 12,
        marginBottom: 14,
        background: 'var(--card)',
        border: '1px solid var(--border)',
        borderLeft: '3px solid var(--positive)',
        borderRadius: 6,
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--positive)' }}>
        Cash advisor
      </div>
      <div style={{ marginTop: 4, fontSize: 13 }}>{headline}</div>
      {detail}
    </div>
  );
}
