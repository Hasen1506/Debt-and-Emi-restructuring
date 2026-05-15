import { api, type SimulateResponse, type UserPayload } from '@/lib/api';
import { loadProfileServer } from '@/lib/user-store';
import { loadThemeServer } from '@/lib/theme';
import { loadStrategyServer, type StrategyName } from '@/lib/strategy';
import {
  loadHikeModelingServer,
  type HikeModeling,
} from '@/lib/hike-modeling';
import { getCountryMonth } from '@/lib/today';
import {
  applyActivityDeltas,
  loadActivityDeltasServer,
} from '@/lib/activity-cookie';
import { mergeTrajectories } from '@/lib/trajectory';
import { mockTrajectory } from '@/lib/mock-data';
import { deriveMetrics } from '@/lib/derived';
import { ExistingPlan } from '@/components/plan/ExistingPlan';
import { EditorialPlan } from '@/components/plan/EditorialPlan';
import { LedgerPlan } from '@/components/plan/LedgerPlan';
import type { PlanData, MonthlyPaymentBreakdown } from '@/components/plan/PlanData';

function extractMonthlyPayments(
  scenario: SimulateResponse,
): MonthlyPaymentBreakdown[] {
  return scenario.trajectory
    .filter((p) => p.payments_by_loan_index && Object.keys(p.payments_by_loan_index).length > 0)
    .map((p) => {
      const perLoan: Record<number, string> = {};
      for (const [idx, amount] of Object.entries(p.payments_by_loan_index ?? {})) {
        perLoan[Number(idx)] = amount;
      }
      return { month: p.month, perLoan };
    });
}

export const dynamic = 'force-dynamic';

async function loadPlan(
  strategy: StrategyName,
  hikeModeling: HikeModeling,
): Promise<PlanData> {
  const profile = await loadProfileServer();
  // Surplus = income − fixed expenses − scheduled EMIs. Same definition the
  // Home + Debts pages show; previously /plan computed it without subtracting
  // EMIs which made the KPI disagree across pages.
  const surplus = Number(deriveMetrics(profile).surplus);

  // Apply activity-ledger deltas (missed/partial payments + their penalties)
  // to the user's loans BEFORE simulating. Baseline uses the same adjusted
  // loans so the avalanche-vs-minimums diff stays apples-to-apples.
  const deltas = await loadActivityDeltasServer();
  const application = applyActivityDeltas(profile.user.loans, deltas);
  // If the hike toggle is OFF, zero out `annual_hike_rate` so the engine
  // simulates flat income. The stored profile is untouched — toggling back
  // ON next render restores the user's configured rate.
  const adjustedUser: UserPayload = {
    ...profile.user,
    loans: application.loans,
    annual_hike_rate:
      hikeModeling === 'off' ? '0' : profile.user.annual_hike_rate ?? '0',
  };

  // Anchor the simulation's "month 1" to the user's country today, so the
  // hike-effective-month fires on the right calendar month instead of
  // month-13-from-now.
  const simulation_start_month = getCountryMonth(profile.user.country);

  try {
    const [scenario, baseline, restructuring] = await Promise.all([
      api.simulate({
        user: adjustedUser,
        strategy,
        horizon_months: 240,
        marginal_rate: profile.marginalRate,
        simulation_start_month,
      }),
      api.baseline({ user: adjustedUser, horizon_months: 240 }),
      api.restructuring({
        user: adjustedUser,
        marginal_rate: profile.marginalRate,
      }),
    ]);
    const monthsSaved =
      scenario.debt_free_month && baseline.debt_free_month
        ? baseline.debt_free_month - scenario.debt_free_month
        : 0;
    return {
      trajectory: mergeTrajectories(scenario, baseline),
      debtFreeMonth: scenario.debt_free_month,
      totalInterest: scenario.total_interest_paid,
      baselineInterest: baseline.total_interest_paid,
      monthsSaved,
      live: true,
      profileIsLive: profile.isLive,
      surplus,
      opportunities: restructuring.opportunities,
      totalAnnualSaving: restructuring.total_annual_saving,
      user: profile.user,
      marginalRate: profile.marginalRate,
      strategy,
      hikeModeling,
      monthlyPayments: extractMonthlyPayments(scenario),
      activityImpact:
        application.entryCount > 0
          ? {
              perLoanBumps: application.perLoanBumps,
              totalBump: application.totalBump,
              entryCount: application.entryCount,
            }
          : null,
    };
  } catch {
    return {
      trajectory: mockTrajectory,
      debtFreeMonth: null,
      totalInterest: '240000',
      baselineInterest: '410000',
      monthsSaved: 14,
      live: false,
      profileIsLive: profile.isLive,
      surplus,
      opportunities: [],
      totalAnnualSaving: '0',
      user: profile.user as UserPayload,
      marginalRate: profile.marginalRate,
      strategy,
      hikeModeling,
      monthlyPayments: [],
      activityImpact: null,
    };
  }
}

export default async function PlanPage() {
  const [theme, strategy, hikeModeling] = await Promise.all([
    loadThemeServer(),
    loadStrategyServer(),
    loadHikeModelingServer(),
  ]);
  const plan = await loadPlan(strategy, hikeModeling);
  if (theme === 'editorial') return <EditorialPlan plan={plan} />;
  if (theme === 'ledger') return <LedgerPlan plan={plan} />;
  return <ExistingPlan plan={plan} />;
}
