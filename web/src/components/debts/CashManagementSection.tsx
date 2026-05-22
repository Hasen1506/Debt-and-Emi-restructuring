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
 *
 * D-pilot: themed primitives for the section header.
 */

import type { StoredProfile } from '@/lib/user-store';
import { InfoTip } from '@/components/ToolPrimitives';
import { CashAdvisorCard } from '@/components/debts/CashAdvisorCard';
import { TaxSleeveCard } from '@/components/debts/TaxSleeveCard';
import { MonthlyRecapCard } from '@/components/debts/MonthlyRecapCard';
import { CashSummaryCard } from '@/components/debts/CashSummaryCard';
import { THEME_TOKENS } from '@/styles/theme-tokens';
import type { ThemeName } from '@/lib/theme';

export function CashManagementSection({
  profile,
  variant,
}: {
  profile: StoredProfile;
  variant: ThemeName;
}) {
  const explainer = (
    <InfoTip>
      <strong>What is &quot;cash management&quot;?</strong> The cards below
      treat your idle cash as a first-class actor, not an afterthought.
      <div style={{ marginTop: 8 }}>
        • <strong>Cash advisor</strong> — when your idle cash is earning less
        than your debt costs, suggests a specific transfer.
      </div>
      <div style={{ marginTop: 4 }}>
        • <strong>Tax sleeve</strong> — for users whose tax isn&apos;t fully
        handled by employer TDS, tracks your next advance-tax installment.
      </div>
      <div style={{ marginTop: 4 }}>
        • <strong>Monthly recap</strong> — once a month, confirm or override
        last month&apos;s income / expenses / EMIs. Keeps your balance honest.
      </div>
      <div style={{ marginTop: 4 }}>
        • <strong>Cash summary</strong> — your accounts at a glance: total,
        optimizable (savings/HYSA), operational float (checking).
      </div>
    </InfoTip>
  );

  const t = THEME_TOKENS[variant].label;
  const upper = variant === 'ledger';
  // Section header — bigger margin top + bottom than a card-level label,
  // and the ledger variant wraps in em-dashes to read as a divider.
  const headerStyle: React.CSSProperties = {
    fontSize: variant === 'existing' ? 14 : t.fontSize,
    fontWeight: variant === 'existing' ? 600 : undefined,
    letterSpacing: t.letterSpacing,
    textTransform: t.textTransform,
    color: variant === 'existing' ? 'var(--ink)' : 'var(--muted)',
    fontFamily: variant === 'ledger' ? 'var(--font-mono)' : undefined,
    margin: variant === 'existing' ? '8px 0 6px' : '20px 0 10px',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
  };
  const headerText = upper ? '— CASH MANAGEMENT —' : 'Cash management';

  return (
    <section>
      <div style={headerStyle}>
        {headerText}
        {explainer}
      </div>
      <CashAdvisorCard profile={profile} variant={variant} />
      <TaxSleeveCard user={profile.user} variant={variant} />
      <MonthlyRecapCard user={profile.user} variant={variant} />
      <CashSummaryCard user={profile.user} variant={variant} />
    </section>
  );
}
