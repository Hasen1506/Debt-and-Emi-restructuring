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
import { TOKENS } from '@/styles/theme-tokens';
import { sleeveAnnualTarget } from '@/lib/tax-sleeve';

export function CashManagementSection({
  profile,
}: {
  profile: StoredProfile;
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

  const t = TOKENS.label;
  // Section header — bigger margin top + bottom than a card-level label,
  // wrapped in em-dashes to read as a divider.
  const headerStyle: React.CSSProperties = {
    fontSize: t.fontSize,
    fontWeight: undefined,
    letterSpacing: t.letterSpacing,
    textTransform: t.textTransform,
    color: 'var(--muted)',
    fontFamily: 'var(--font-mono)',
    margin: '20px 0 10px',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
  };
  const headerText = '— CASH MANAGEMENT —';

  // Every card below needs either cash accounts or a tax sleeve; without
  // both, the header would sit over an empty section.
  if (!(profile.user.cash_accounts?.length) && !(sleeveAnnualTarget(profile.user) ?? 0)) {
    return null;
  }

  return (
    <section>
      <div style={headerStyle}>
        {headerText}
        {explainer}
      </div>
      <CashAdvisorCard profile={profile} />
      <TaxSleeveCard user={profile.user} />
      <MonthlyRecapCard user={profile.user} />
      <CashSummaryCard user={profile.user} />
    </section>
  );
}
