/**
 * Re-test 10 R10-4: Setup step 3's "then put ₹X extra on your …" sentence
 * reads Home's own whole-rupee split (payThisMonth), so the two can't
 * differ. Setup used to subtract the minimums run's payment from the
 * plan's payment and round the difference (₹10,60,995), while Home rounds
 * each loan's payment and minimum and caps the extra at what's left after
 * the EMIs and set-aside (₹10,60,994).
 */
import type { PlanData } from '@/components/plan/PlanData';
import type { SimulateResponse, UserPayload } from '@/lib/api';
import { payThisMonth } from '@/lib/pay-this-month';
import { extractMonthlyPayments } from '@/lib/trajectory';

/** The loan getting the largest extra this month and that extra, in the
 *  loan's own currency, as Home's Pay this month lists it; null when no
 *  loan gets an extra (or the month is short). */
export function setupExtraMove(
  plan: SimulateResponse,
  minimums: SimulateResponse,
  user: UserPayload,
): { index: number; extra: number } | null {
  const month = setupPayMonth(plan, minimums, user);
  if (!month || Number(plan.shortfall ?? 0) > 0.5) return null;
  let best: { index: number; extra: number; user: number } | null = null;
  for (const r of month.rows) {
    if (r.loanIndex === null || !(r.extra >= 1)) continue;
    // Largest in one currency: ₹4.8 lakh is not more than $6,000.
    const user = r.amount > 0 ? (r.extra / r.amount) * r.amountUser : r.extra;
    if (!best || user > best.user) best = { index: r.loanIndex, extra: r.extra, user };
  }
  return best ? { index: best.index, extra: best.extra } : null;
}

/** This month's payments as Home will list them (UX walkthrough fix 8:
 *  Setup's short-month priority order reads the same rows). */
export function setupPayMonth(plan: SimulateResponse, minimums: SimulateResponse, user: UserPayload) {
  const sa = plan.surplus_allocation;
  const asPlan = {
    live: true,
    user,
    monthlyPayments: extractMonthlyPayments(plan),
    trajectory: plan.trajectory
      .filter((p) => p.month >= 1)
      .map((p) => ({ month: p.month, balancesByLoanIndex: p.balances_by_loan_index })),
    firstMonthMinimums: extractMonthlyPayments(minimums).find((p) => p.month === 1)?.perLoan ?? {},
    fxRatesUsed: user.fx_to_user_currency ?? {},
    surplusAllocation: sa
      ? { surplus: Number(sa.surplus), goalSlice: Number(sa.goal_slice), efSlice: Number(sa.ef_slice), debtSlice: Number(sa.debt_slice) }
      : null,
    surplus: sa ? Number(sa.surplus) : 0,
    shortfall: Number(plan.shortfall ?? 0),
    debtBudget: 0, // Setup's preview: all spare cash. Plan and Home then ask for the total (lib/debt-budget).
  } as unknown as PlanData;
  return payThisMonth(asPlan);
}
