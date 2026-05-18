import { api, type SimulateResponse, type UserPayload } from '@/lib/api';
import { loadFxCacheServer, loadProfileServer } from '@/lib/user-store';
import { loadThemeServer } from '@/lib/theme';
import { loadStrategyServer, type StrategyName } from '@/lib/strategy';
import {
  loadHikeModelingServer,
  type HikeModeling,
} from '@/lib/hike-modeling';
import {
  loadTaxReinvestServer,
  type TaxReinvestSetting,
} from '@/lib/tax-reinvest';
import {
  loadInflationModelingServer,
  type InflationModeling,
} from '@/lib/inflation-modeling';
import {
  loadFxDriftServer,
  defaultDriftForLoanCurrency,
  type FxDriftSetting,
} from '@/lib/fx-drift';
import { computeAnnualTax, isAdvanceTaxApplicable } from '@/lib/tax-brackets';
import { readScheduleServer } from '@/lib/advance-tax-cookie';
import {
  readLifecycleServer,
  plannedEventsForEngine,
} from '@/lib/lifecycle-events';
import {
  buildSchedule,
  accruedPenalty,
  type AdvanceTaxSchedule,
} from '@/lib/advance-tax';
import { markMissedInstalments } from '@/lib/advance-tax-cookie';
import { projectAnnualTaxSavings } from '@/lib/tax-projection';
import { projectBracketTransitions } from '@/lib/bracket-transitions';
import Decimal from 'decimal.js';
import { getCountryMonth } from '@/lib/today';
import {
  applyActivityDeltas,
  loadActivityDeltasServer,
} from '@/lib/activity-cookie';
import { mergeTrajectories } from '@/lib/trajectory';
import { mockTrajectory } from '@/lib/mock-data';
import { deriveMetrics } from '@/lib/derived';
import {
  currenciesInPlay,
  derivePerCurrencyMetrics,
  ensureFxRates,
  userDefaultCurrency,
} from '@/lib/currency';
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
  taxReinvest: TaxReinvestSetting,
  inflationModeling: InflationModeling,
  fxDrift: FxDriftSetting,
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
  let adjustedUser: UserPayload = {
    ...profile.user,
    loans: application.loans,
    annual_hike_rate:
      hikeModeling === 'off' ? '0' : profile.user.annual_hike_rate ?? '0',
  };
  // Make sure the engine receives FX rates for any non-default-currency
  // loan so its surplus / DTI math doesn't silently fall back to parity.
  // No-op for single-currency users (the common case). Seed from the
  // FX-cache cookie when fresh so we skip the network call entirely on
  // repeat /plan loads within the 24h TTL.
  const fxCache = await loadFxCacheServer();
  adjustedUser = await ensureFxRates(adjustedUser, api.fxRate, {
    cached: fxCache?.rates,
  });
  const fxRatesUsed = adjustedUser.fx_to_user_currency ?? {};

  // FX drift — for each non-residence currency in play, attach the
  // default drift rate (currently only NRI-US/INR is configured). When
  // toggle is off the dict stays empty so the engine sees flat FX.
  if (fxDrift === 'on') {
    const drift: Record<string, string> = {};
    for (const ccy of Object.keys(fxRatesUsed)) {
      const r = defaultDriftForLoanCurrency(ccy, adjustedUser.country);
      if (r !== '0') drift[ccy] = r;
    }
    if (Object.keys(drift).length > 0) {
      adjustedUser = { ...adjustedUser, fx_drift_annualized: drift };
    }
  }

  // Anchor the simulation's "month 1" to the user's country today, so the
  // hike-effective-month fires on the right calendar month instead of
  // month-13-from-now.
  const simulation_start_month = getCountryMonth(profile.user.country);

  // Bracket-transition projection — only meaningful when the user has
  // provided gross income (otherwise we can't classify their current
  // bracket). Honours hike toggle: when off, no transitions because no
  // income growth. Empty list when no transitions occur over horizon.
  const grossForBracket =
    adjustedUser.income_type === 'salaried'
      ? Number(adjustedUser.annual_gross_salary || 0)
      : Number(adjustedUser.annual_business_income || 0);
  const bracketTransitions =
    grossForBracket > 0 && hikeModeling === 'on'
      ? projectBracketTransitions({
          country: adjustedUser.country,
          taxRegime: adjustedUser.tax_regime,
          incomeType: adjustedUser.income_type,
          grossIncome: grossForBracket,
          annualHikeRate: Number(adjustedUser.annual_hike_rate || 0),
          hikeSchedule: adjustedUser.hike_schedule,
          horizonYears: 20,
          filingStatus: adjustedUser.filing_status,
        })
      : [];

  // Advance-tax schedule — load from cookie if present, otherwise build a
  // fresh one when the user is SE + has gross income that triggers Sec 208
  // / 1040-ES threshold. The cookie preserves the user's mark-paid history
  // across sessions; we only rebuild on first visit OR when the FY's last
  // instalment is in the past (stale schedule). Salaried users skip this
  // entirely — their TDS / W-2 withholding covers it.
  let advanceTaxSchedule: AdvanceTaxSchedule | null = null;
  if (adjustedUser.income_type === 'business_owner') {
    const grossForTax =
      Number(adjustedUser.annual_business_income || 0)
      || Number(adjustedUser.annual_gross_salary || 0);
    if (grossForTax > 0) {
      const annualTax = computeAnnualTax(
        adjustedUser.country,
        adjustedUser.tax_regime,
        adjustedUser.income_type,
        grossForTax,
        adjustedUser.filing_status,
      );
      if (isAdvanceTaxApplicable(adjustedUser.country, adjustedUser.income_type, annualTax)) {
        // Prefer the user's existing cookie schedule (preserves mark-paid
        // history); fall back to fresh generation when missing or stale.
        const stored = await readScheduleServer();
        const today = new Date();
        const todayIso = today.toISOString().slice(0, 10);
        const storedStale =
          stored
            && stored.instalments.length > 0
            && stored.instalments[stored.instalments.length - 1].dueDate < todayIso;
        if (stored && !storedStale && stored.country === adjustedUser.country) {
          // Run the missed-event auto-mint each render so past-due
          // unpaid rows are flagged before the panel renders.
          advanceTaxSchedule = markMissedInstalments(stored, today);
        } else {
          advanceTaxSchedule = buildSchedule(
            adjustedUser.country,
            annualTax,
            today,
          );
        }
      }
    }
  }

  // Fold the advance-tax penalty into surplus math so the trajectory
  // actually shifts when a user has missed instalments. Approach: spread
  // accrued + projected penalty over 12 months and add to fixed_expenses
  // for the simulation call. Engine already subtracts fixed_expenses from
  // surplus, so this propagates without engine changes.
  //
  // Users who pay on time → accruedPenalty.total = 0 → no surplus change.
  // Users with missed instalments → surplus shrinks by ~₹X/mo → debt-free
  // month pushes out → the penalty's cost becomes visible in the plan,
  // not just the panel.
  let advanceTaxPenaltyMonthly = 0;
  if (advanceTaxSchedule) {
    const accrued = accruedPenalty(advanceTaxSchedule, new Date());
    const total = Number(accrued.total);
    if (total > 0) {
      advanceTaxPenaltyMonthly = total / 12;
      adjustedUser = {
        ...adjustedUser,
        fixed_expenses: String(
          Number(adjustedUser.fixed_expenses || 0) + advanceTaxPenaltyMonthly,
        ),
      };
    }
  }

  // Pre-compute auto-reinvest events when the toggle is on. Per-year tax
  // savings = capped deductible interest × marginal_rate, applied at the
  // post-ITR-filing month. Empty when toggle is off, regime gates all
  // deductions (India new), or marginal_rate is zero.
  const fxMap = adjustedUser.fx_to_user_currency ?? {};
  const reinvestEvents =
    taxReinvest === 'on'
      ? projectAnnualTaxSavings(adjustedUser, {
          country: adjustedUser.country,
          taxRegime: adjustedUser.tax_regime,
          marginalRate: new Decimal(profile.marginalRate || 0),
          fxToUserCcy: (amount, loanCcy) => {
            const userCcy = adjustedUser.country === 'US' ? 'USD' : 'INR';
            if (loanCcy === userCcy) return amount;
            return amount.mul(new Decimal(fxMap[loanCcy] ?? '1'));
          },
          horizonYears: 20,
        }).map((y) => ({
          month: y.applyMonth,
          amount: y.taxSaving.toFixed(2),
        }))
      : [];

  // Pull planned lifecycle events (salary / rate resets with effectiveDate
  // in the future) into the engine wire format. Confirmed past events are
  // already baked into the profile via L1 immediate-apply on confirm.
  const lifecycleEventsRaw = await readLifecycleServer();
  const lifecycle_events = plannedEventsForEngine(lifecycleEventsRaw);

  // Soft EF waterfall — when the user has an EF gap, divert 30% of each
  // month's surplus to EF top-up until target is hit. Phase 3 of the
  // cash module. 0 (legacy) when target already met or unset.
  const efBalance = Number(adjustedUser.efund_balance ?? '0');
  const efTarget = Number(adjustedUser.efund_target ?? '0');
  const efTopUpRate = efTarget > 0 && efBalance < efTarget ? '0.3' : undefined;

  try {
    const [scenario, baseline, restructuring] = await Promise.all([
      api.simulate({
        user: adjustedUser,
        strategy,
        horizon_months: 240,
        marginal_rate: profile.marginalRate,
        simulation_start_month,
        reinvest_events: reinvestEvents.length > 0 ? reinvestEvents : undefined,
        inflate_expenses: inflationModeling === 'on' ? true : undefined,
        lifecycle_events: lifecycle_events.length > 0 ? lifecycle_events : undefined,
        ef_top_up_rate: efTopUpRate,
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
    const scenarioPayments = extractMonthlyPayments(scenario);
    const baselinePayments = extractMonthlyPayments(baseline);
    const ccyList = currenciesInPlay(adjustedUser.loans, adjustedUser.country);
    const byCurrency = derivePerCurrencyMetrics(
      adjustedUser.loans,
      scenarioPayments,
      adjustedUser.country,
    );
    const byCurrencyBaseline = derivePerCurrencyMetrics(
      adjustedUser.loans,
      baselinePayments,
      adjustedUser.country,
    );
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
      inflationModeling,
      fxDrift,
      bracketTransitions,
      advanceTaxSchedule,
      advanceTaxPenaltyMonthly,
      taxReinvest,
      taxReinvestProjection: reinvestEvents,
      monthlyPayments: scenarioPayments,
      activityImpact:
        application.entryCount > 0
          ? {
              perLoanBumps: application.perLoanBumps,
              totalBump: application.totalBump,
              entryCount: application.entryCount,
            }
          : null,
      currenciesInPlay: ccyList,
      displayCurrency: userDefaultCurrency(adjustedUser.country),
      byCurrency,
      byCurrencyBaseline,
      fxRatesUsed,
    };
  } catch {
    const ccyList = currenciesInPlay(profile.user.loans, profile.user.country);
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
      inflationModeling,
      fxDrift,
      bracketTransitions,
      advanceTaxSchedule,
      advanceTaxPenaltyMonthly,
      taxReinvest,
      taxReinvestProjection: [],
      monthlyPayments: [],
      activityImpact: null,
      currenciesInPlay: ccyList,
      displayCurrency: userDefaultCurrency(profile.user.country),
      byCurrency: {},
      byCurrencyBaseline: {},
      fxRatesUsed: {},
    };
  }
}

export default async function PlanPage() {
  const [theme, strategy, hikeModeling, taxReinvest, inflationModeling, fxDrift] =
    await Promise.all([
      loadThemeServer(),
      loadStrategyServer(),
      loadHikeModelingServer(),
      loadTaxReinvestServer(),
      loadInflationModelingServer(),
      loadFxDriftServer(),
    ]);
  const plan = await loadPlan(
    strategy, hikeModeling, taxReinvest, inflationModeling, fxDrift,
  );
  if (theme === 'editorial') return <EditorialPlan plan={plan} />;
  if (theme === 'ledger') return <LedgerPlan plan={plan} />;
  return <ExistingPlan plan={plan} />;
}
