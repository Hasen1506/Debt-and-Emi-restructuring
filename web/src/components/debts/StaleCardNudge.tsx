'use client';

/**
 * Gentle, non-blocking reminder shown on /debts when a credit card hasn't
 * had any activity logged in the last STALE_DAYS days (or ever). The
 * trajectory in /plan drifts from reality without periodic balance
 * refresh, especially on revolving cards.
 *
 * Reads localStorage directly via readActivityClient; renders nothing
 * pre-hydration to avoid SSR/CSR mismatch.
 */

import { useEffect, useState } from 'react';
import type { UserPayload } from '@/lib/api';
import { readActivityClient } from '@/lib/activity';

const STALE_DAYS = 45;

type Variant = 'ledger' | 'editorial' | 'existing';

export function StaleCardNudge({
  user,
  variant,
}: {
  user: UserPayload;
  variant: Variant;
}) {
  const [stale, setStale] = useState<{ bank: string; daysSince: number | null }[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const entries = readActivityClient();
    const lastByLoan = new Map<number, string>();
    for (const e of entries) {
      // Entries arrive newest-first; first sighting per loan wins.
      if (!lastByLoan.has(e.loanIndex)) lastByLoan.set(e.loanIndex, e.date);
    }
    const result: { bank: string; daysSince: number | null }[] = [];
    user.loans.forEach((loan, idx) => {
      if (loan.loan_type !== 'credit_card') return;
      const last = lastByLoan.get(idx);
      if (!last) {
        result.push({ bank: loan.bank || `Card #${idx + 1}`, daysSince: null });
        return;
      }
      const days = Math.floor(
        (Date.now() - new Date(last).getTime()) / 86_400_000,
      );
      if (days > STALE_DAYS) {
        result.push({ bank: loan.bank || `Card #${idx + 1}`, daysSince: days });
      }
    });
    setStale(result);
    setReady(true);
  }, [user.loans]);

  if (!ready || stale.length === 0) return null;

  return (
    <div style={containerStyle(variant)}>
      <div style={labelStyle(variant)}>
        {variant === 'ledger' ? '$ STALE · CARD BALANCES' : 'Card balances may have drifted'}
      </div>
      <div style={{ marginTop: 6, fontSize: 13, lineHeight: 1.55 }}>
        {stale.length === 1
          ? `${stale[0].bank}: `
          : `${stale.length} cards: `}
        {stale.map((s, i) => (
          <span key={s.bank}>
            {i > 0 && ', '}
            <strong>{s.bank}</strong>
            {s.daysSince ? ` (${s.daysSince}d since last update)` : ' (never updated)'}
          </span>
        ))}
        .{' '}
        <a href="/insights" style={{ color: 'var(--accent)' }}>
          Log this cycle&apos;s payment
        </a>{' '}
        — entering the new outstanding keeps the /plan trajectory anchored to
        reality.
      </div>
    </div>
  );
}

function containerStyle(variant: Variant): React.CSSProperties {
  if (variant === 'ledger') {
    return {
      fontFamily: 'var(--font-mono)',
      fontSize: 12,
      lineHeight: 1.55,
      borderLeft: '3px solid var(--accent)',
      paddingLeft: 12,
      marginBottom: 14,
    };
  }
  if (variant === 'editorial') {
    return {
      margin: '14px 0 18px',
      paddingLeft: 14,
      borderLeft: '3px solid var(--accent)',
    };
  }
  return {
    padding: 12,
    marginBottom: 14,
    background: 'var(--card)',
    border: '1px solid var(--border)',
    borderLeft: '3px solid var(--accent)',
    borderRadius: 6,
  };
}

function labelStyle(variant: Variant): React.CSSProperties {
  if (variant === 'ledger') {
    return {
      fontSize: 11,
      color: 'var(--accent)',
      letterSpacing: '0.18em',
      textTransform: 'uppercase',
    };
  }
  if (variant === 'editorial') {
    return {
      fontFamily: 'var(--font-sans)',
      fontSize: 11,
      letterSpacing: '0.15em',
      textTransform: 'uppercase',
      color: 'var(--accent)',
    };
  }
  return { fontSize: 13, fontWeight: 600, color: 'var(--accent)' };
}
