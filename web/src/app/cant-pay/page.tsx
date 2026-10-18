import { CantPay, type CantPayPlanRow } from '@/components/distress/CantPay';
import { loadPlanFromCookies } from '@/components/plan/load-plan';
import { owedNowByLoan } from '@/components/plan/plan-milestones';
import { payThisMonth } from '@/lib/pay-this-month';
import { loanToUser } from '@/lib/currency';
import { shortDay } from '@/lib/owed-today';

/**
 * "I can't pay this month" triage (sprint L4). Reached from Home's
 * "Feeling overwhelmed?" soft view. Reads the saved profile on the client.
 * Owed-fix (18 Oct 2026): this month's plan payments (Home's pay list), what
 * is already paid and what's owed now come from the same plan run as Home,
 * so "still to pay" and "owes now" are Home's figures.
 */
export const metadata = { title: "Can't pay this month · RightDue" };

export default async function CantPayPage() {
  let planRows: CantPayPlanRow[] = [];
  try {
    const plan = await loadPlanFromCookies();
    const data = plan.profileIsLive ? payThisMonth(plan) : null;
    if (data) {
      const owed = owedNowByLoan(plan);
      const paidEmis = new Set(plan.runArgs?.paid_emi_this_month ?? []);
      const toUser = (v: number, i: number) => loanToUser(v, plan.user.loans[i], plan.user.country, plan.fxRatesUsed) ?? v;
      planRows = data.rows
        .filter((r) => r.loanIndex !== null)
        .map((r) => {
          const i = r.loanIndex!;
          const note = plan.paidNow?.find((p) => p.index === i);
          // Cards: the payments logged this month; EMI loans: the EMI, once marked paid.
          const paid = note ? note.paid : paidEmis.has(i) ? r.minimum : 0;
          return {
            key: r.key,
            amountUser: r.amountUser,
            minimumUser: r.amount > 0 ? (r.minimum / r.amount) * r.amountUser : 0,
            paidUser: toUser(paid, i),
            paidDay: note?.date ? shortDay(note.date) : '',
            owedNowUser: toUser(Number(owed[i]?.outstanding) || 0, i),
          };
        });
    }
  } catch {
    // Offline or signed out: the page works from the profile alone.
  }
  return <CantPay planRows={planRows} />;
}
