/**
 * Shared shape produced by Plan page's data loader and consumed by every
 * theme variant (ExistingPlan, EditorialPlan, LedgerPlan).
 */
import type {
  RestructuringOpportunity,
  UserPayload,
} from '@/lib/api';
import type { TrajectoryPoint } from '@/lib/mock-data';
import type { StrategyName } from '@/lib/strategy';

/**
 * Per-month per-loan payment breakdown sourced from the engine.
 *
 * `perLoan` keys are 0-based positions into `PlanData.user.loans`, so
 * callers join against `user.loans[index].bank` for the human label.
 * Amounts are stringified Decimals — convert with Number() / Decimal()
 * at the render site to preserve precision.
 */
export interface MonthlyPaymentBreakdown {
  month: number;
  perLoan: Record<number, string>;
}

export interface PlanData {
  trajectory: TrajectoryPoint[];
  debtFreeMonth: number | null;
  totalInterest: string;
  baselineInterest: string;
  monthsSaved: number;
  live: boolean;
  profileIsLive: boolean;
  surplus: number;
  opportunities: RestructuringOpportunity[];
  totalAnnualSaving: string;
  user: UserPayload;
  marginalRate: string;
  /** Active payoff strategy used to compute trajectory + debtFreeMonth. */
  strategy: StrategyName;
  /** Month-by-month per-loan payments for the active strategy. Empty when
   *  the engine call falls back to mock data (offline mode). */
  monthlyPayments: MonthlyPaymentBreakdown[];
}
