/**
 * The footer under Plan's month-by-month schedule: how its columns add up
 * to what you owe today (audit 2026-10-07 §1). The schedule's TOTAL is cash
 * paid (principal + interest, GST included), Home's OUTSTANDING is principal
 * only; without a footer the two looked like they disagreed.
 */
export interface ScheduleTotals {
  principal: number;
  interest: number;
  cash: number;
  /** What's owed today across all loans, in the same currency. */
  outstanding: number;
  /** principal − outstanding: new loans the plan adds later, balances
   *  carried past the plan, or rounding. 0 when they tie out. */
  gap: number;
  tiesOut: boolean;
}

export function reconcileSchedule(
  rows: { interest: number; principal: number }[],
  outstanding: number,
): ScheduleTotals {
  const principal = rows.reduce((s, r) => s + r.principal, 0);
  const interest = rows.reduce((s, r) => s + r.interest, 0);
  const gap = principal - outstanding;
  // Within half a percent (or one unit) is rounding across many months.
  const tiesOut = Math.abs(gap) <= Math.max(1, Math.abs(outstanding) * 0.005);
  return { principal, interest, cash: principal + interest, outstanding, gap, tiesOut };
}

/** Column help, shown as tooltips on the schedule's headers. */
export function scheduleColumnHelp(gstApplies: boolean, gstPct: string): Record<'INTEREST' | 'PRINCIPAL' | 'BALANCE' | 'EXTRA', string> {
  return {
    INTEREST: gstApplies
      ? `Interest the banks charge that month, including ${gstPct}% GST on credit-card interest.`
      : 'Interest the banks charge that month.',
    PRINCIPAL: 'The part of the month’s payments that reduces what you owe.',
    BALANCE: 'What you still owe at the end of the month (principal only).',
    EXTRA: 'Paid on top of the EMIs and card minimums.',
  };
}

/**
 * A payoff that is more than the balance, explained: this month's interest
 * (and GST on card interest in India) is added before the loan clears,
 * e.g. "₹50,000 owed + ₹1,750 interest + ₹315 GST".
 */
export function payoffBreakdown(owed: number, monthlyInterest: number, gst: number, fmt: (n: number) => string): string {
  const parts = [`${fmt(owed)} owed`];
  if (monthlyInterest > 0.5) parts.push(`${fmt(monthlyInterest)} interest`);
  if (gst > 0.5) parts.push(`${fmt(gst)} GST`);
  return parts.join(' + ');
}
