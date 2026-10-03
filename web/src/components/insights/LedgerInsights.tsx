/**
 * Activity (REDESIGN R4): the month-by-month ledger of what was paid and
 * what changed. `/activity#activity-ledger` lands on it; `?log=payment&loan=2`
 * opens the log dialog for that loan.
 */

import type { PlanRunArgs, UserPayload } from '@/lib/api';
import type { StrategyName } from '@/lib/strategy';
import type { RolledLoan } from '@/lib/roll-forward';
import { ActivityPage } from '@/components/activity/ActivityPage';
import { LShell } from '@/components/ledger/primitives';

export function LedgerInsights({
  user,
  runArgs,
  strategy,
  rolled,
  planPay,
}: {
  user: UserPayload;
  runArgs: PlanRunArgs | null;
  strategy: StrategyName;
  rolled: RolledLoan[];
  planPay?: Record<number, { amount: number; minimum: number; extra: number }>;
}) {
  return (
    <LShell>
      <div id="activity-ledger" style={{ flex: 1, padding: '4px 0 0', scrollMarginTop: 24 }}>
        <ActivityPage user={user} runArgs={runArgs} strategy={strategy} rolled={rolled} planPay={planPay} />
      </div>
    </LShell>
  );
}
