import { loadProfileServer } from '@/lib/user-store';
import { loadPlanFromCookies, loadPlanInputsFromCookies } from '@/components/plan/load-plan';
import { payThisMonth } from '@/lib/pay-this-month';
import { LedgerInsights } from '@/components/insights/LedgerInsights';

export const dynamic = 'force-dynamic';

export default async function ActivityRoute() {
  // The plan's inputs (not a run of it): the log dialog previews each
  // entry against them.
  // The plan's run too (cached with Home's), so this month's payments
  // match what Home asks for.
  const [profile, inputs, plan] = await Promise.all([
    loadProfileServer(),
    loadPlanInputsFromCookies().catch(() => null),
    loadPlanFromCookies().catch(() => null),
  ]);
  const pay = plan ? payThisMonth(plan) : null;
  const planPay = pay
    ? Object.fromEntries(
        pay.rows
          .filter((r) => r.loanIndex !== null)
          .map((r) => [r.loanIndex as number, { amount: r.amount, minimum: r.minimum, extra: r.extra }]),
      )
    : undefined;
  return (
    <>
      <h1 className="sr-only">Activity</h1>
      <LedgerInsights
        user={profile.user}
        runArgs={inputs?.simBaseArgs ?? null}
        strategy={inputs?.strategy ?? 'avalanche'}
        rolled={inputs?.rolled ?? []}
        planPay={planPay}
      />
    </>
  );
}
