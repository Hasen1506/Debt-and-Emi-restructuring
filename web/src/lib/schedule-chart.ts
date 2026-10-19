/**
 * The month-by-month table and the trajectory chart share one balance
 * series. BALANCE in the table is the engine's plan line (avalanche).
 * Gap borrowing is its own column, so it is not added onto the line the
 * chart plots. Month 0 is what's owed now, the table's start row.
 */
import type { PlanData } from '@/components/plan/PlanData';
import { owedNowAtStart } from '@/components/plan/plan-milestones';

export interface ChartBalance {
  month: number;
  /** Table BALANCE. Gap borrowing is not included. */
  balance: number;
  /** Dashed "minimums only" line. Not a table column, and gap is not added. */
  minimums: number;
}

/** Plan balance at a schedule month, the same number the BALANCE cell shows. */
export function balanceByMonth(plan: { trajectory: Array<{ month: number; avalanche: number }> }): Map<number, number> {
  return new Map(plan.trajectory.map((p) => [p.month, p.avalanche]));
}

/**
 * Points the chart plots, in the same currency and rounding as the table.
 * Includes month 0 (owed now) when the schedule starts at month 1.
 */
export function chartBalances(plan: PlanData): ChartBalance[] {
  const rows: ChartBalance[] = plan.trajectory.map((p) => ({
    month: p.month,
    balance: p.avalanche,
    minimums: p.minimums,
  }));
  const start = plan.trajectory[0]?.month === 1 ? owedNowAtStart(plan) : 0;
  return start > 0 ? [{ month: 0, balance: start, minimums: start }, ...rows] : rows;
}
