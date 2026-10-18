import { CantPay, type CantPayPlanRow } from '@/components/distress/CantPay';
import { loadPlanFromCookies } from '@/components/plan/load-plan';
import { payThisMonth } from '@/lib/pay-this-month';

/**
 * "I can't pay this month" triage (sprint L4). Reached from Home's
 * "Feeling overwhelmed?" soft view. Reads the saved profile on the client;
 * this month's plan payments (Home's pay list) come from the server so
 * "still to pay" is the figure Home shows (owed-fix).
 */
export const metadata = { title: "Can't pay this month · RightDue" };

export default async function CantPayPage() {
  let planRows: CantPayPlanRow[] = [];
  try {
    const plan = await loadPlanFromCookies();
    const data = plan.profileIsLive ? payThisMonth(plan) : null;
    planRows = (data?.rows ?? [])
      .filter((r) => r.loanIndex !== null)
      .map((r) => ({
        key: r.key,
        amountUser: r.amountUser,
        minimumUser: r.amount > 0 ? (r.minimum / r.amount) * r.amountUser : 0,
      }));
  } catch {
    // Offline or signed out: the page works from the profile alone.
  }
  return <CantPay planRows={planRows} />;
}
