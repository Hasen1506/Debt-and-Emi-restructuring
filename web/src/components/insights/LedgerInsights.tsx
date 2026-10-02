/**
 * Activity (REDESIGN R4): the month-by-month ledger of what was paid and
 * what changed. `/activity#activity-ledger` lands on it; `?log=payment&loan=2`
 * opens the log dialog for that loan.
 */

import type { PlanRunArgs, UserPayload } from '@/lib/api';
import type { StrategyName } from '@/lib/strategy';
import { ActivityPage } from '@/components/activity/ActivityPage';
import { LShell } from '@/components/ledger/primitives';

export function LedgerInsights({
  user,
  runArgs,
  strategy,
}: {
  user: UserPayload;
  runArgs: PlanRunArgs | null;
  strategy: StrategyName;
}) {
  return (
    <LShell>
      <div id="activity-ledger" style={{ flex: 1, padding: '4px 0 0', scrollMarginTop: 24 }}>
        <ActivityPage user={user} runArgs={runArgs} strategy={strategy} />
      </div>
    </LShell>
  );
}
