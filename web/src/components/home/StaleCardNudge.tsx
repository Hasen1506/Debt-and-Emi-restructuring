'use client';

/**
 * One line above Open positions when a credit card's balance hasn't been
 * updated in STALE_DAYS days (or ever): a card's balance moves with every
 * purchase, so the plan drifts from the statement without it. UPDATE goes
 * to Activity, where a payment can carry the card's new balance; DISMISS
 * hides it for a week.
 *
 * Reads localStorage, so it renders nothing until mounted (no SSR mismatch).
 */

import { useEffect, useState } from 'react';
import type { UserPayload } from '@/lib/api';
import { BALANCES_ENTERED_KEY, readActivityClient } from '@/lib/activity';
import { alignToLoans } from '@/lib/loan-ids';
import { LBracket, L_T } from '@/components/ledger/primitives';

const STALE_DAYS = 45;

/** "HDFC card", or "Credit card" (numbered when several have no name). */
function cardName(bank: string | undefined, idx: number, loans: UserPayload['loans']): string {
  if (bank) return `${bank} card`;
  const unnamed = loans.filter((l) => l.loan_type === 'credit_card' && !l.bank);
  return unnamed.length > 1 ? `Credit card ${unnamed.indexOf(loans[idx]) + 1}` : 'Credit card';
}
const SNOOZE_KEY = 'finoptima_stale_snooze_until';

export function StaleCardNudge({ user }: { user: UserPayload }) {
  const [stale, setStale] = useState<{ bank: string; daysSince: number | null }[]>([]);
  const [ready, setReady] = useState(false);
  const [snoozed, setSnoozed] = useState(false);

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
        result.push({ bank: cardName(loan.bank, idx, user.loans), daysSince: null });
        return;
      }
      const days = Math.floor(
        (Date.now() - new Date(last).getTime()) / 86_400_000,
      );
      if (days > STALE_DAYS) {
        result.push({ bank: cardName(loan.bank, idx, user.loans), daysSince: days });
      }
    });
    setStale(result);
    try {
      const until = window.localStorage.getItem(SNOOZE_KEY);
      setSnoozed(!!until && until > new Date().toISOString());
    } catch {
      setSnoozed(false);
    }
    setReady(true);
  }, [user.loans]);

  function snooze() {
    try {
      window.localStorage.setItem(SNOOZE_KEY, new Date(Date.now() + 7 * 86_400_000).toISOString());
    } catch {
      /* hidden for this visit only */
    }
    setSnoozed(true);
  }

  if (!ready || snoozed || stale.length === 0) return null;

  return (
    <div
      role="note"
      style={{
        marginBottom: 14,
        padding: '10px 14px',
        border: `1px solid ${L_T.ink}`,
        background: L_T.paper,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        gap: 12,
        flexWrap: 'wrap',
        fontSize: 12,
        lineHeight: 1.6,
      }}
    >
      <span>
        <strong style={{ letterSpacing: '0.12em', color: L_T.accent }}>UPDATE · </strong>
        {stale.map((s, i) => (
          <span key={s.bank}>
            {i > 0 && ', '}
            {s.bank}
            {s.daysSince ? ` (${s.daysSince} days)` : ' (never)'}
          </span>
        ))}
        : {stale.length > 1 ? 'these card balances haven’t' : 'this card balance hasn’t'} been updated, so the plan may be off.
      </span>
      <span style={{ display: 'flex', gap: 12 }}>
        <LBracket accent href="/activity#activity-ledger">
          UPDATE THE BALANCE →
        </LBracket>
        <LBracket onClick={snooze}>DISMISS FOR A WEEK</LBracket>
      </span>
    </div>
  );
}
