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
import { BALANCES_ENTERED_KEY, readActivityClient } from '@/lib/activity';
import { alignToLoans } from '@/lib/loan-ids';
import { ThemedContainer, ThemedHeadline, ThemedLabel } from '@/components/themed/Themed';

const STALE_DAYS = 45;

export function StaleCardNudge({
  user,
}: {
  user: UserPayload;
}) {
  const [stale, setStale] = useState<{ bank: string; daysSince: number | null }[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // Each entry at its loan's current position (by id).
    const entries = alignToLoans(readActivityClient(), user.loans);
    const lastByLoan = new Map<number, string>();
    for (const e of entries) {
      // Entries arrive newest-first; first sighting per loan wins.
      if (!lastByLoan.has(e.loanIndex)) lastByLoan.set(e.loanIndex, e.date);
    }
    // Balances typed into setup count as an update.
    let entered: string | null = null;
    try {
      entered = window.localStorage.getItem(BALANCES_ENTERED_KEY);
    } catch {
      entered = null;
    }
    const result: { bank: string; daysSince: number | null }[] = [];
    user.loans.forEach((loan, idx) => {
      if (loan.loan_type !== 'credit_card') return;
      const logged = lastByLoan.get(idx);
      const last = logged && entered ? (logged > entered ? logged : entered) : logged ?? entered ?? undefined;
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
    <ThemedContainer tone="accent" style={{ marginBottom: 14 }}>
      <ThemedLabel tone="accent">
        {'STALE · CARD BALANCES'}
      </ThemedLabel>
      <ThemedHeadline>
        {stale.length > 1 && `${stale.length} cards: `}
        {stale.map((s, i) => (
          <span key={s.bank}>
            {i > 0 && ', '}
            <strong>{s.bank}</strong>
            {s.daysSince ? ` (${s.daysSince}d since last update)` : ' (never updated)'}
          </span>
        ))}
        .{' '}
        <a href="/insights" style={{ color: 'var(--accent)', textDecoration: 'underline' }}>
          Log this cycle&apos;s payment
        </a>{' '}
        — entering the new outstanding keeps the /plan trajectory anchored to
        reality.
      </ThemedHeadline>
    </ThemedContainer>
  );
}
