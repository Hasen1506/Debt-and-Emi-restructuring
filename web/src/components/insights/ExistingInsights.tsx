import { ActivityLedger } from './ActivityLedger';
import type { StoredProfile } from '@/lib/user-store';

export function ExistingInsights({ profile }: { profile: StoredProfile }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <section>
        <h1 className="h1">Activity</h1>
        <p className="muted">
          Record real payment events so the projection reflects what
          actually happened, not the optimistic baseline. Partial / missed
          entries show an estimated penalty drawn from each bank&apos;s
          published Schedule of Charges.
        </p>
      </section>
      <ActivityLedger user={profile.user} variant="existing" />
    </div>
  );
}
