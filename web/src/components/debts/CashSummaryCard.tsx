'use client';

/**
 * Cash summary card — surfaces the user's per-account cash breakdown
 * (entered at onboarding step 4) alongside their debts. Phase 1 is pure
 * display: the cash-vs-debt advisor card and operational-float floor
 * logic come in later phases.
 *
 * Renders nothing when the user hasn't populated `cash_accounts` — keeps
 * legacy single-balance users seeing the same /debts they always did.
 */

import { Card } from '@/components/Card';
import { formatCurrency } from '@/lib/api';
import type { CashAccountPayload, UserPayload } from '@/lib/api';
import { userDefaultCurrency } from '@/lib/currency';
import { InfoTip } from '@/components/ToolPrimitives';

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
      <a href="/onboarding?step=4" style={{ color: 'var(--accent)' }}>
        Setup → Cash &amp; savings
      </a>
      .
    </div>
  </>
);

type Variant = 'ledger' | 'editorial' | 'existing';

const KIND_LABEL: Record<CashAccountPayload['kind'], string> = {
  checking: 'Checking',
  savings: 'Savings',
  hysa: 'HYSA',
  fd: 'FD',
  other: 'Other',
};

export function CashSummaryCard({
  user,
  variant,
}: {
  user: UserPayload;
  variant: Variant;
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

  if (variant === 'ledger') {
    return (
      <div
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 12,
          lineHeight: 1.55,
          borderLeft: '3px solid var(--accent)',
          paddingLeft: 12,
          marginBottom: 14,
        }}
      >
        <div
          style={{
            fontSize: 11,
            color: 'var(--accent)',
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          $ CASH · {accounts.length} ACCOUNT{accounts.length === 1 ? '' : 'S'}
          <InfoTip>{CASH_TIP}</InfoTip>
        </div>
        <div style={{ marginTop: 6 }}>
          Total <strong>{formatCurrency(String(total), currency)}</strong>
          {' '}· optimizable{' '}
          <strong>{formatCurrency(String(optimizable), currency)}</strong>
          {' '}· float{' '}
          {formatCurrency(String(float), currency)}
          {weightedApy > 0 && (
            <> · earning ~{(weightedApy * 100).toFixed(2)}% APY</>
          )}
        </div>
        <div style={{ marginTop: 4, color: 'var(--muted-ink)' }}>
          {accounts.map((a, i) => (
            <span key={i}>
              {i > 0 && ' · '}
              {a.name} {formatCurrency(a.balance || '0', currency)}
              {Number(a.apy) > 0 && ` @ ${(Number(a.apy) * 100).toFixed(2)}%`}
            </span>
          ))}
        </div>
      </div>
    );
  }

  if (variant === 'editorial') {
    return (
      <div
        style={{
          margin: '14px 0 18px',
          paddingLeft: 14,
          borderLeft: '3px solid var(--accent)',
        }}
      >
        <div
          style={{
            fontFamily: 'var(--font-sans)',
            fontSize: 11,
            letterSpacing: '0.15em',
            textTransform: 'uppercase',
            color: 'var(--accent)',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          Cash on hand
          <InfoTip>{CASH_TIP}</InfoTip>
        </div>
        <div style={{ marginTop: 6, fontSize: 14, lineHeight: 1.55 }}>
          Across {accounts.length} account{accounts.length === 1 ? '' : 's'}:{' '}
          <strong>{formatCurrency(String(total), currency)}</strong> total
          {weightedApy > 0 && (
            <>
              {' '}· earning roughly{' '}
              <strong>{(weightedApy * 100).toFixed(2)}%</strong> APY on the
              optimizable portion
            </>
          )}
          .
        </div>
        <div className="muted" style={{ marginTop: 4, fontSize: 12, lineHeight: 1.5 }}>
          {accounts.map((a, i) => (
            <span key={i}>
              {i > 0 && ' · '}
              {a.name} ({KIND_LABEL[a.kind]}){' '}
              {formatCurrency(a.balance || '0', currency)}
              {Number(a.apy) > 0 && ` @ ${(Number(a.apy) * 100).toFixed(2)}%`}
            </span>
          ))}
        </div>
      </div>
    );
  }

  // 'existing' — warm card layout
  return (
    <Card>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          gap: 16,
          flexWrap: 'wrap',
          alignItems: 'baseline',
        }}
      >
        <div style={{ minWidth: 0, flex: 1 }}>
          <div
            style={{
              fontWeight: 600,
              fontSize: 15,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            Cash on hand{' '}
            <span className="muted" style={{ fontWeight: 400 }}>
              · {accounts.length} account{accounts.length === 1 ? '' : 's'}
            </span>
            <InfoTip>{CASH_TIP}</InfoTip>
          </div>
          <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
            Optimizable {formatCurrency(String(optimizable), currency)} · float{' '}
            {formatCurrency(String(float), currency)}
            {weightedApy > 0 && (
              <> · earning ~{(weightedApy * 100).toFixed(2)}% APY</>
            )}
          </div>
        </div>
        <div className="num" style={{ fontSize: 16, fontWeight: 600 }}>
          {formatCurrency(String(total), currency)}
        </div>
      </div>
      <div
        className="muted"
        style={{
          marginTop: 10,
          fontSize: 12,
          lineHeight: 1.5,
          display: 'flex',
          flexWrap: 'wrap',
          gap: 8,
        }}
      >
        {accounts.map((a, i) => (
          <span
            key={i}
            style={{
              padding: '4px 8px',
              border: '1px solid var(--border)',
              borderRadius: 4,
              background: 'var(--canvas)',
              whiteSpace: 'nowrap',
            }}
          >
            <strong style={{ color: 'var(--ink)' }}>{a.name}</strong>{' '}
            <span style={{ color: 'var(--muted-ink)' }}>
              ({KIND_LABEL[a.kind]})
            </span>{' '}
            {formatCurrency(a.balance || '0', currency)}
            {Number(a.apy) > 0 && (
              <span style={{ color: 'var(--muted-ink)' }}>
                {' '}
                @ {(Number(a.apy) * 100).toFixed(2)}%
              </span>
            )}
          </span>
        ))}
      </div>
    </Card>
  );
}
