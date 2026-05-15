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
}
