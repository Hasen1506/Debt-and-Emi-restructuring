'use client';

/**
 * Activity: the ledger of what was actually paid. The engine's notes that
 * used to sit above it moved to Plan (REDESIGN R3.4); R4 rebuilds this page.
 * The deep link /activity#activity-ledger lands on the ledger.
 */

import type { StoredProfile } from '@/lib/user-store';
import type { StrategyName } from '@/lib/strategy';
import { ActivityLedger } from './ActivityLedger';
import { LShell, LSectionHeader, L_MONO } from '@/components/ledger/primitives';

export function LedgerInsights({
  profile,
  strategy: _strategy,
}: {
  profile: StoredProfile;
  strategy: StrategyName;
}) {
  return (
    <LShell>
      <div
        style={{
          flex: 1,
          padding: '4px 0 0',
          display: 'flex',
          flexDirection: 'column',
          gap: 22,
          fontFamily: L_MONO,
        }}
      >
        <section>
          <LSectionHeader>ACTUALS · ACTIVITY LEDGER</LSectionHeader>
          <ActivityLedger user={profile.user} variant="ledger" />
        </section>
      </div>
    </LShell>
  );
}
