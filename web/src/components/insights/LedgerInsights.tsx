/**
 * Ledger Insights — user-recorded activity ledger.
 *
 * Replaces the previous hardcoded LOG + CALENDAR arrays with a manual
 * payment-event log driven by `ActivityLedger`. Form on top, entries
 * table below; both in the statement aesthetic. Per-entry penalty
 * estimate uses the bank's Schedule of Charges when available, otherwise
 * a country/loan-type default.
 */

import { ActivityLedger } from './ActivityLedger';
import { AdvanceTaxLedger } from './AdvanceTaxLedger';
import { InsightsSummaryStrip } from './InsightsSummaryStrip';
import type { StoredProfile } from '@/lib/user-store';

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 11,
        color: 'var(--muted)',
        letterSpacing: '0.18em',
        marginBottom: 6,
        fontFamily: 'var(--font-mono)',
      }}
    >
      {children}
    </div>
  );
}

export function LedgerInsights({ profile }: { profile: StoredProfile }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 22,
        fontFamily: 'var(--font-mono)',
        fontSize: 12,
        lineHeight: 1.55,
      }}
    >
      <section>
        <SectionLabel>$ HISTORY · AUDIT TRAIL · BACKWARD-LOOKING</SectionLabel>
        <div
          style={{
            fontSize: 11,
            color: 'var(--muted)',
            letterSpacing: '0.04em',
            lineHeight: 1.65,
            marginBottom: 10,
            background: 'var(--card)',
            border: '1px dashed var(--border)',
            padding: '10px 12px',
          }}
        >
          Where <a href="/plan" style={{ color: 'var(--accent)' }}>$ PLAN</a> is
          forward-looking, this page is the record of what actually happened —
          paid in full, partial, missed, or extra, plus advance-tax instalments.
          Penalty estimates use each bank&apos;s published Schedule of Charges,
          falling back to country/loan-type medians (₹500 + 2-3%/month on
          consumer credit; 18% GST in IN).
        </div>
      </section>

      <InsightsSummaryStrip user={profile.user} variant="ledger" />

      <ActivityLedger user={profile.user} variant="ledger" />
      <AdvanceTaxLedger user={profile.user} variant="ledger" />
    </div>
  );
}
