'use client';

/**
 * Cash-vs-debt advisor card — Phase 5 of the cash module.
 *
 * Renders only when computeCashAdvice() finds a real opportunity:
 *   • user has cash_accounts populated
 *   • at least one active loan
 *   • eligible cash above the reserve floor (≥ MIN_EXCESS)
 *   • highest-rate debt's effective APR beats the post-tax cash APY by ≥ 2pp
 *
 * Once those gates pass, the card shows the concrete move with the math:
 *   "Move ₹X from <lowest-APY account> to <highest-rate bank>.
 *    Saves ₹Y / year. Reserve kept untouched: ₹Z."
 *
 * D-pilot: rewritten to use the themed primitives.
 */

import { useEffect, useMemo, useState } from 'react';
import type { StoredProfile } from '@/lib/user-store';
import { formatCurrency } from '@/lib/api';
import { fmt } from '@/lib/effective-apr';
import { userDefaultCurrency } from '@/lib/currency';
import { computeCashAdvice, lowestApySource } from '@/lib/cash-advisor';
import {
  ThemedContainer,
  ThemedDetail,
  ThemedHeadline,
  ThemedLabel,
} from '@/components/themed/Themed';

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
}: {
  profile: StoredProfile;
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
  const labelText = 'ADVISOR · CASH → DEBT';

  return (
    <ThemedContainer tone="positive" style={{ marginBottom: 14 }}>
      <ThemedLabel tone="positive">
        {labelText}
      </ThemedLabel>
      <ThemedHeadline>
        Move{' '}
        <strong>{formatCurrency(advice.excess.toString(), currency)}</strong> from{' '}
        <strong>{source.name}</strong> to{' '}
        <strong>{advice.loudest.loan.bank || 'top-rate debt'}</strong>{' '}
        {loanLabel}. Saves about{' '}
        <strong style={{ color: 'var(--positive)' }}>
          {formatCurrency(advice.annualSaving.toString(), currency)}/year
        </strong>{' '}
        in interest.
      </ThemedHeadline>
      <ThemedDetail>
        <div>
          Cash post-tax yield ~{fmt(advice.postTaxApy)} vs. {loanLabel} effective{' '}
          {fmt(advice.loudest.effective)} — {fmt(advice.spread)} spread.
        </div>
        <div style={{ marginTop: 4 }}>
          Reserve kept untouched:{' '}
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
      </ThemedDetail>
    </ThemedContainer>
  );
}
