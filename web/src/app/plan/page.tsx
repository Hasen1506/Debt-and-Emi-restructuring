import { api, type UserPayload } from '@/lib/api';
import { loadProfileServer } from '@/lib/user-store';
import { loadThemeServer } from '@/lib/theme';
import { mergeTrajectories } from '@/lib/trajectory';
import { mockTrajectory } from '@/lib/mock-data';
import { ExistingPlan } from '@/components/plan/ExistingPlan';
import { EditorialPlan } from '@/components/plan/EditorialPlan';
import { LedgerPlan } from '@/components/plan/LedgerPlan';
import type { PlanData } from '@/components/plan/PlanData';

export const dynamic = 'force-dynamic';

async function loadPlan(): Promise<PlanData> {
  const profile = await loadProfileServer();
  const surplus = Number(profile.user.monthly_income) - Number(profile.user.fixed_expenses);
  try {
    const [avalanche, baseline, restructuring] = await Promise.all([
      api.simulate({
        user: profile.user,
        strategy: 'avalanche',
        horizon_months: 240,
        marginal_rate: profile.marginalRate,
      }),
      api.baseline({ user: profile.user, horizon_months: 240 }),
      api.restructuring({
        user: profile.user,
        marginal_rate: profile.marginalRate,
      }),
    ]);
    const monthsSaved =
      avalanche.debt_free_month && baseline.debt_free_month
        ? baseline.debt_free_month - avalanche.debt_free_month
        : 0;
    return {
      trajectory: mergeTrajectories(avalanche, baseline),
      debtFreeMonth: avalanche.debt_free_month,
      totalInterest: avalanche.total_interest_paid,
      baselineInterest: baseline.total_interest_paid,
      monthsSaved,
      live: true,
      profileIsLive: profile.isLive,
      surplus,
      opportunities: restructuring.opportunities,
      totalAnnualSaving: restructuring.total_annual_saving,
      user: profile.user,
      marginalRate: profile.marginalRate,
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
    };
  }
}

export default async function PlanPage() {
  const [plan, theme] = await Promise.all([loadPlan(), loadThemeServer()]);
  if (theme === 'editorial') return <EditorialPlan plan={plan} />;
  if (theme === 'ledger') return <LedgerPlan plan={plan} />;
  return <ExistingPlan plan={plan} />;
}
