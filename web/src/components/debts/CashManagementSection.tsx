'use client';

/**
 * One labeled section containing every cash-related card so /debts has
 * a coherent rhythm instead of five free-floating cards. The cards
 * themselves still no-op individually when prerequisites are missing —
 * the wrapper just gives them visual grouping.
 *
 * Order inside the section is priority-first:
 *   1. CashAdvisorCard   — the actionable recommendation
 *   2. TaxSleeveCard     — time-sensitive (red when near deadline)
 *   3. MonthlyRecapCard  — collapsed-by-default check-in
 *   4. CashSummaryCard   — per-account snapshot (reference, not action)
 */

import type { StoredProfile } from '@/lib/user-store';
import { CashAdvisorCard } from '@/components/debts/CashAdvisorCard';
import { TaxSleeveCard } from '@/components/debts/TaxSleeveCard';
import { MonthlyRecapCard } from '@/components/debts/MonthlyRecapCard';
import { CashSummaryCard } from '@/components/debts/CashSummaryCard';

type Variant = 'ledger' | 'editorial' | 'existing';

export function CashManagementSection({
  profile,
  variant,
}: {
  profile: StoredProfile;
  variant: Variant;
}) {
  const header =
    variant === 'ledger' ? (
      <div
        style={{
          fontSize: 11,
          color: 'var(--muted)',
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
          fontFamily: 'var(--font-mono)',
          margin: '20px 0 10px',
        }}
      >
        — CASH MANAGEMENT —
      </div>
    ) : variant === 'editorial' ? (
      <div
        style={{
          fontFamily: 'var(--font-sans)',
          fontSize: 11,
          letterSpacing: '0.15em',
          textTransform: 'uppercase',
          color: 'var(--muted, var(--ink))',
          margin: '24px 0 10px',
        }}
      >
        Cash management
      </div>
    ) : (
      <div
        style={{
          fontSize: 14,
          fontWeight: 600,
          color: 'var(--ink)',
          margin: '8px 0 6px',
        }}
      >
        Cash management
      </div>
    );

  return (
    <section>
      {header}
      <CashAdvisorCard profile={profile} variant={variant} />
      <TaxSleeveCard user={profile.user} variant={variant} />
      <MonthlyRecapCard user={profile.user} variant={variant} />
      <CashSummaryCard user={profile.user} variant={variant} />
    </section>
  );
}
