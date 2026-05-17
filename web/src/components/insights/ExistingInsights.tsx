import { ActivityLedger } from './ActivityLedger';
import { AdvanceTaxLedger } from './AdvanceTaxLedger';
import { InsightsSummaryStrip } from './InsightsSummaryStrip';
import type { StoredProfile } from '@/lib/user-store';

export function ExistingInsights({ profile }: { profile: StoredProfile }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <section>
        <h1 className="h1">Audit trail</h1>
        <p className="muted">
          Where <a href="/plan">Plan</a> looks forward, this page is the
          record of what actually happened. Log real payment events — paid,
          partial, missed, extra — plus your advance-tax instalments.
          Partial / missed entries show an estimated penalty drawn from each
          bank&apos;s published Schedule of Charges.
        </p>
      </section>
      <InsightsSummaryStrip user={profile.user} variant="existing" />
      <ActivityLedger user={profile.user} variant="existing" />
      <AdvanceTaxLedger user={profile.user} variant="existing" />
    </div>
  );
}
