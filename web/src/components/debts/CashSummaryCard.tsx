'use client';

/**
 * Cash summary card — surfaces the user's per-account cash breakdown
 * (entered at onboarding step 4) alongside their debts. Phase 1 is pure
 * display: the cash-vs-debt advisor card and operational-float floor
 * logic come in later phases.
 *
 * Renders nothing when the user hasn't populated `cash_accounts` — keeps
 * legacy single-balance users seeing the same /debts they always did.
 *
 * D-pilot: rewritten to use the themed primitives. One render path,
 * three themes via the token table.
 */

import { formatCurrency } from '@/lib/api';
import type { CashAccountPayload, UserPayload } from '@/lib/api';
import { userDefaultCurrency } from '@/lib/currency';
import { InfoTip } from '@/components/ToolPrimitives';
import {
  ThemedContainer,
  ThemedDetail,
  ThemedLabel,
} from '@/components/themed/Themed';

const CASH_TIP = (
  <>
    <strong>Float vs optimizable.</strong> "Float" is your checking
    balance — money you need liquid for daily spend, not earning meaningful
    interest. "Optimizable" is everything else (savings, HYSA, FD, other)
    — that's the bucket the advisor card above can recommend sweeping into
    debt or into the EF tier.
    <div style={{ marginTop: 8 }}>
      <strong>APY shown</strong> is the balance-weighted average across the
      optimizable accounts only — float doesn&apos;t pull the number down.
    </div>
    <div style={{ marginTop: 8 }}>
      Edit individual account balances and rates in{' '}
      <a href="/profile?step=4" style={{ color: 'var(--accent)' }}>
        Setup → Cash &amp; savings
      </a>
      .
    </div>
  </>
);

const KIND_LABEL: Record<CashAccountPayload['kind'], string> = {
  checking: 'Checking',
  savings: 'Savings',
  hysa: 'HYSA',
  fd: 'FD',
  other: 'Other',
};

export function CashSummaryCard({
  user,
}: {
  user: UserPayload;
}) {
  const accounts = user.cash_accounts ?? [];
  if (accounts.length === 0) return null;

  const currency = userDefaultCurrency(user.country);
  const total = accounts.reduce((s, a) => s + Number(a.balance || 0), 0);
  const optimizable = accounts
    .filter((a) => a.kind !== 'checking')
    .reduce((s, a) => s + Number(a.balance || 0), 0);
  const float = total - optimizable;

  // Weighted-average APY across optimizable accounts only — operational
  // float is parked, not earning meaningfully.
  let weightedApy = 0;
  if (optimizable > 0) {
    const num = accounts
      .filter((a) => a.kind !== 'checking')
      .reduce(
        (s, a) => s + Number(a.balance || 0) * Number(a.apy || 0),
        0,
      );
    weightedApy = num / optimizable;
  }

  const labelText = `CASH · ${accounts.length} ACCOUNT${accounts.length === 1 ? '' : 'S'}`;

  return (
    <ThemedContainer tone="accent" style={{ marginBottom: 14 }}>
      <ThemedLabel
        tone="accent"
        trailing={<InfoTip>{CASH_TIP}</InfoTip>}
      >
        {labelText}
      </ThemedLabel>
      <div style={{ fontWeight: 400 }}>
        Total <strong>{formatCurrency(String(total), currency)}</strong>
        {' · '}optimizable{' '}
        <strong>{formatCurrency(String(optimizable), currency)}</strong>
        {' · '}float {formatCurrency(String(float), currency)}
        {weightedApy > 0 && (
          <> · earning ~{(weightedApy * 100).toFixed(2)}% APY</>
        )}
      </div>
      <ThemedDetail>
        {accounts.map((a, i) => (
          <span key={i} style={{ marginRight: 10, display: 'inline-block' }}>
            <strong style={{ color: 'var(--ink)' }}>{a.name}</strong>{' '}
            <span style={{ color: 'var(--muted)' }}>({KIND_LABEL[a.kind]})</span>{' '}
            {formatCurrency(a.balance || '0', currency)}
            {Number(a.apy) > 0 && (
              <span style={{ color: 'var(--muted)' }}>
                {' '}@ {(Number(a.apy) * 100).toFixed(2)}%
              </span>
            )}
          </span>
        ))}
      </ThemedDetail>
    </ThemedContainer>
  );
}
