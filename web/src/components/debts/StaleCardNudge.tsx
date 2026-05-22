'use client';

/**
 * Gentle, non-blocking reminder shown on /debts when a credit card hasn't
 * had any activity logged in the last STALE_DAYS days (or ever). The
 * trajectory in /plan drifts from reality without periodic balance
 * refresh, especially on revolving cards.
 *
 * Reads localStorage directly via readActivityClient; renders nothing
 * pre-hydration to avoid SSR/CSR mismatch.
 *
 * D-pilot: themed primitives.
 */

import { useEffect, useState } from 'react';
import type { UserPayload } from '@/lib/api';
import { readActivityClient } from '@/lib/activity';
import { ThemedContainer, ThemedHeadline, ThemedLabel } from '@/components/themed/Themed';
import type { ThemeName } from '@/lib/theme';

const STALE_DAYS = 45;

export function StaleCardNudge({
  user,
  variant,
}: {
  user: UserPayload;
  variant: ThemeName;
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

  const upper = variant === 'ledger';
  return (
    <ThemedContainer variant={variant} tone="accent" style={{ marginBottom: 14 }}>
      <ThemedLabel variant={variant} tone="accent">
        {upper ? 'STALE · CARD BALANCES' : 'Card balances may have drifted'}
      </ThemedLabel>
      <ThemedHeadline variant={variant}>
        {stale.length === 1 ? `${stale[0].bank}: ` : `${stale.length} cards: `}
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
      </ThemedHeadline>
    </ThemedContainer>
  );
}
