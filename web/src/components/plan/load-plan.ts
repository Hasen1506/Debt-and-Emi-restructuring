/**
 * Server-side plan loader, shared by /plan and the home page so both show
 * the same debt-free date. Runs the engine (plan, pay-minimums comparison,
 * restructure scan, the other two strategies) and shapes PlanData.
 */
import { promoForEngine } from '@/lib/promo-rate';
import { jointForEngine } from '@/lib/joint-share';
import { api, formatCurrencyWhole, type SimulateResponse, type UserPayload, type LifecycleEventInput } from '@/lib/api';
import { cachedEngineCall } from '@/lib/server-engine-cache';
import { loadProfileServer } from '@/lib/user-store';
import { efTopUpShare } from '@/lib/assumptions';
import { loadStrategyServer, STRATEGIES, type StrategyName } from '@/lib/strategy';
import { loadRulesServer, rulesForLoans, rulesOrDefault } from '@/lib/payoff-rules';
import {
  loadHikeModelingServer,
  type HikeModeling,
} from '@/lib/hike-modeling';
import {
  loadTaxReinvestServer,
  type TaxReinvestSetting,
} from '@/lib/tax-reinvest';
import {
  inflationRateFor,
  loadInflationModelingServer,
  loadInflationRateServer,
  type InflationModeling,
} from '@/lib/inflation-modeling';
import {
  loadFxDriftServer,
  defaultDriftForLoanCurrency,
  type FxDriftSetting,
} from '@/lib/fx-drift';
import { computeAnnualTax, isAdvanceTaxApplicable } from '@/lib/tax-brackets';
import { readScheduleServer } from '@/lib/advance-tax-cookie';
import { salariedAdvanceTaxNote, salariedAdvanceTaxRequest, scheduleFromResponse } from '@/lib/salaried-advance-tax';
import {
  readLifecycleServer,
  plannedEventsForEngine,
} from '@/lib/lifecycle-events';
import { streamTransitionsAsLifecycleEvents } from '@/lib/income-streams';
import {
  buildSchedule,
  rebaseSchedule,
  accruedPenalty,
  type AdvanceTaxSchedule,
} from '@/lib/advance-tax';
import { markMissedInstalments } from '@/lib/advance-tax-cookie';
import { projectAnnualTaxSavings } from '@/lib/tax-projection';
import { projectBracketTransitions } from '@/lib/bracket-transitions';
import Decimal from 'decimal.js';
import { countryMonthKey, getCountryMonth, getCountryToday, localIsoDate } from '@/lib/today';
import { paidAtEntryThisMonth, prepareLoanPaymentTiming, rollBalancesForward } from '@/lib/roll-forward';
import { owedTodayOf } from '@/lib/owed-today';
import { HORIZON_MONTHS } from '@/lib/horizon';
import {
  applyActivityDeltas,
  loadActivityDeltasServer,
  loadActivityPaceServer,
  loadPaidNowServer,
} from '@/lib/activity-cookie';
import { PACE_MONTHS, monthsBefore, paceDiffers, paceProjectionGap, paceSummary } from '@/lib/pace';
import { extractMonthlyPayments, mergeTrajectories } from '@/lib/trajectory';
import { planEnd, planGap, shownDebtFreeMonth } from '@/lib/plan-gap';
import { mockTrajectory } from '@/lib/mock-data';
import { deriveMetrics } from '@/lib/derived';
import { projectionGaps } from '@/lib/loan-gaps';
import {
  currenciesInPlay,
  derivePerCurrencyMetrics,
  loanToUser,
  loanMarket,
  userDefaultCurrency,
} from '@/lib/currency';
import type { PlanData, MonthlyPaymentBreakdown } from '@/components/plan/PlanData';



/** Everything the plan runs on, read from the cookies, before the engine
 *  is called: the profile with logged activity applied, its settings, life
 *  events and goals. `simBaseArgs` is what /simulate gets (less the
 *  strategy). Activity uses it to preview an entry against the plan. */
export async function loadPlanInputs(
  hikeModeling: HikeModeling,
  taxReinvest: TaxReinvestSetting,
  inflationModeling: InflationModeling,
  fxDrift: FxDriftSetting,
) {
  const profile = await loadProfileServer();
  // Surplus = income − fixed expenses − scheduled EMIs. Same definition the
  // Home + Debts pages show; previously /plan computed it without subtracting
  // EMIs which made the KPI disagree across pages.
  let surplus = Number(deriveMetrics(profile).surplus);

  // Apply activity-ledger deltas (missed/partial payments + their penalties)
  // to the user's loans BEFORE simulating. Baseline uses the same adjusted
  // loans so the avalanche-vs-minimums diff stays apples-to-apples.
  const deltas = await loadActivityDeltasServer();
  // Balances entered months ago move on by the EMIs due since (R4.5).
  const { loans: rolledLoans, rolled } = rollBalancesForward(profile.user.loans, countryMonthKey(profile.user.country));
  const application = applyActivityDeltas(rolledLoans, deltas, countryMonthKey(profile.user.country));
  // If the hike toggle is OFF, zero out `annual_hike_rate` so the engine
  // simulates flat income. The stored profile is untouched — toggling back
  // ON next render restores the user's configured rate.
  // Rising prices: the user's own rate from Plan, else the central bank's
  // latest forecast (the profile's saved rate was only ever a default).
  const ownInflation = await loadInflationRateServer();
  let adjustedUser: UserPayload = {
    ...profile.user,
    inflation_rate: inflationRateFor(profile.user.country, ownInflation),
    loans: application.loans,
    annual_hike_rate:
      hikeModeling === 'off' ? '0' : profile.user.annual_hike_rate ?? '0',
    hike_schedule: hikeModeling === 'off' ? [] : profile.user.hike_schedule,
  };
  // The exchange rates saved with the profile (setup asks for one per
  // foreign currency). A loan without one is a gap below: the engine would
  // take it at parity, ₹20 lakh as $20 lakh. Home, /debts and /plan all
  // use this one rate, so they agree.
  surplus = Number(deriveMetrics({...profile,user:adjustedUser}).surplus);
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

  // Anchor the simulation's "month 1" to the user's chosen start month,
  // falling back to country-today when no override is set. Lets users
  // who say "I'll start serious budgeting from next month" or "from FY
  // start" line up the projection with their actual zero-day.
  // The plan starts this month, from the balances the user entered.
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
        const todayIso = localIsoDate(today);
        const storedStale =
          stored
            && stored.instalments.length > 0
            && stored.instalments[stored.instalments.length - 1].dueDate < todayIso;
        if (stored && !storedStale && stored.country === adjustedUser.country) {
          // Run the missed-event auto-mint each render so past-due
          // unpaid rows are flagged before the panel renders.
          // W2: re-cut the remaining instalments when the year's estimate moved.
          advanceTaxSchedule = markMissedInstalments(rebaseSchedule(stored, annualTax), today);
        } else {
          advanceTaxSchedule = buildSchedule(
            adjustedUser.country,
            annualTax,
            today,
            // s.408(2): presumptive income pays once, by 15 March.
            { presumptive: (adjustedUser.income_streams ?? []).some((st) => st.tax_treatment === 'business_44ada') },
          );
        }
      }
    }
  }

  // Round 2 (founder, item 5): a SALARIED Indian user whose other income
  // has no TDS (interest, gains, rent, freelance) gets the panel too, once
  // the tax it adds after TDS is ₹10,000 or more (engine/tax/advance_tax.py).
  let advanceTaxNote: string | null = null;
  if (!advanceTaxSchedule) {
    const todayIso = localIsoDate(new Date());
    const req = salariedAdvanceTaxRequest(adjustedUser, todayIso);
    const res = req ? await api.salariedAdvanceTax(req).catch(() => null) : null;
    const fresh = res ? scheduleFromResponse(res, todayIso) : null;
    if (res && fresh) {
      const stored = await readScheduleServer();
      const storedOk =
        stored
          && stored.country === 'IN'
          && stored.instalments.length > 0
          && stored.instalments[stored.instalments.length - 1].dueDate >= todayIso;
      advanceTaxSchedule = storedOk
        ? markMissedInstalments(rebaseSchedule(stored, new Decimal(res.liability)), new Date())
        : fresh;
      advanceTaxNote = salariedAdvanceTaxNote(res, (v) => formatCurrencyWhole(String(Math.round(Number(v))), 'INR'));
    }
  }
  // Round 3 (ux-walkthrough fix 10): a salaried user who gave the tax on other
  // income directly (Profile → Income, "tax on non-TDS income") gets the same
  // schedule, at s.404 [208]'s ₹10,000 (US: over $1,000, Form 1040-ES).
  const extraTax = Number(adjustedUser.income_type === 'salaried' ? adjustedUser.extra_income_annual_tax || 0 : 0);
  if (!advanceTaxSchedule && (adjustedUser.country === 'IN' ? extraTax >= 10_000 : extraTax > 1_000)) {
    const stored = await readScheduleServer();
    const fresh = buildSchedule(adjustedUser.country, new Decimal(extraTax), new Date());
    advanceTaxSchedule = stored && stored.country === adjustedUser.country && fresh && stored.instalments.at(-1)?.dueDate === fresh.instalments.at(-1)?.dueDate
      ? markMissedInstalments(rebaseSchedule(stored, new Decimal(extraTax)), new Date())
      : fresh;
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
  // post-ITR-filing month. Empty when the regime gates all deductions
  // (India new), nothing is itemised above the US standard deduction, or
  // marginal_rate is zero. Projected whatever the toggle says: its label
  // shows the amount ("no loan tax deductions" appeared, toggle off, next
  // to a home loan whose rate counted a shield). The engine gets it only
  // when the toggle is on.
  const fxMap = adjustedUser.fx_to_user_currency ?? {};
  const projectedTaxSavings = projectAnnualTaxSavings(adjustedUser, {
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
  }));
  const reinvestEvents = taxReinvest === 'on' ? projectedTaxSavings : [];

  // Pull planned lifecycle events (salary / rate resets with effectiveDate
  // in the future) into the engine wire format. Confirmed past events are
  // already baked into the profile via L1 immediate-apply on confirm.
  const lifecycleEventsRaw = await readLifecycleServer();
  // Manual events (planned salary / rate resets) PLUS synthesized events
  // from income_streams whose start or end date falls inside the horizon.
  // Without the synthesized batch the engine would hold marginal income
  // constant for 240 months even when the user has already told us "this
  // freelance stream starts in 3 months" or "salaried gig ends Sept".
  // Translate any per-loan next_reset_date (calendar) to next_reset_month
  // (sim-relative). The engine needs months; the user authored dates.
  // Skipped silently for fixed-rate or unset values.
  function nextResetSimMonth(iso: string | undefined): number | undefined {
    if (!iso) return undefined;
    const t = Date.parse(iso.length === 7 ? `${iso}-01` : iso);
    if (!Number.isFinite(t)) return undefined;
    const today = new Date();
    const target = new Date(t);
    const diff =
      (target.getFullYear() - today.getFullYear()) * 12 +
      (target.getMonth() - today.getMonth()) +
      1;
    return diff > 0 ? diff : undefined;
  }
  // A loan taken this month: the engine starts its EMIs at the first EMI
  // month (lib/roll-forward).
  const planMonth = countryMonthKey(adjustedUser.country);
  adjustedUser.loans = prepareLoanPaymentTiming(adjustedUser.loans, planMonth).map((l) => jointForEngine(promoForEngine(l, planMonth)));
  adjustedUser.loans = adjustedUser.loans.map((l) => {
    if (l.rate_type !== 'floating') return l;
    const computed = nextResetSimMonth(l.next_reset_date);
    // An expected rate change with no reset on file used to be dropped
    // silently. Not sure how often it resets: a repo-linked loan resets at
    // least every three months (a US adjustable one yearly), so the change
    // reaches it one period in. Without a change, nothing is assumed.
    const drift = Number(l.rate_drift_annualized || 0) !== 0;
    const freq = l.rate_reset_frequency_months ?? (drift ? (loanMarket(l, adjustedUser.country) === 'IN' ? 3 : 12) : undefined);
    if (!computed && !freq) return l;
    return {
      ...l,
      rate_reset_frequency_months: freq,
      next_reset_month: computed ?? (drift ? freq : undefined),
    } as typeof l & {
      next_reset_month?: number;
    };
  }) as typeof adjustedUser.loans;

  const lifecycle_events: LifecycleEventInput[] = [
    ...plannedEventsForEngine(lifecycleEventsRaw, localIsoDate(getCountryToday(adjustedUser.country)), adjustedUser.loans, adjustedUser),
    ...streamTransitionsAsLifecycleEvents(
      adjustedUser.income_streams,
      HORIZON_MONTHS,
    ),
  ];

  const displayUser: UserPayload = {...adjustedUser, loans:[...adjustedUser.loans,
    ...lifecycle_events.filter(e => e.kind === 'property_buy' && e.loan_draft).map(e => ({...e.loan_draft!,planned_effective_month:e.effective_month}))]};

  // Soft EF waterfall — when the user has an EF gap, divert a user-chosen
  // fraction of monthly surplus to EF top-up until target is hit. Default
  // 0.3 (30% EF / 70% debt) preserves the pre-slider behaviour; the cookie
  // is the source of truth now that /plan surfaces a control.
  const efBalance = Number(adjustedUser.efund_balance ?? '0');
  const efTarget = Number(adjustedUser.efund_target ?? '0');
  const efSplit = await (await import('@/lib/ef-split')).loadEfSplitServer();
  const debtBudget = await (await import('@/lib/debt-budget')).loadDebtBudgetServer();
  // Audit 80+ A4: the user's own prepay/keep split for when only cheap debt is left.
  const lowRateShare = await (await import('@/lib/low-rate-choice')).loadLowRateShareServer();
  const { goalsForSimulateServer } = await import('@/lib/goals');
  const { readContributionTotalsServer } = await import(
    '@/lib/goal-contributions'
  );
  // Per-goal payload for the engine. Engine runs serial-fill per
  // month, threads saved_so_far across iterations, and returns
  // per-goal contributions for the first sim month plus end-of-
  // trajectory fill rates in `goal_finals`. Empty list when no goals
  // are on file — engine just runs the EF/debt cascade as before.
  //
  // `saved_so_far` per goal comes from the goal-contributions ledger
  // (cookie digest mirror). Without ledger entries it defaults to 0
  // and the run-rate computes against the full funded amount.
  const contributionTotals = await readContributionTotalsServer();
  const goalsForEngine = await goalsForSimulateServer(
    new Date(),
    contributionTotals,
  );
  const hasGoalsForEngine = goalsForEngine.length > 0;
  // The slider's split is the only emergency-fund top-up, sent even at 0%
  // (0 = every rupee to debt) and alongside goals (the engine splits
  // what is left after goals). Omitting it made the engine hold back a
  // fixed gap / 12 instead, so 0% and "has goals" both ignored the slider.
  // A fixed monthly amount set on Profile → Assumptions (roadmap PR D) wins
  // over the slider's share: sent as its share of this month's spare cash.
  const efTopUpRate = efTarget > 0 && efBalance < efTarget ? efTopUpShare(adjustedUser, efSplit, surplus) : undefined;
  // The user's payoff rules ride on the user (engine reads them only when
  // the strategy is 'rules'); none saved = Hybrid's rule (roadmap PR E).
  adjustedUser = {
    ...adjustedUser,
    payoff_rules: rulesForLoans(rulesOrDefault(await loadRulesServer(), adjustedUser.country), adjustedUser.loans.length),
  };

  // Build the same simulate-args dict for every strategy variant so the
  // comparison table reflects "what if you flipped only the strategy".
  // The active strategy still pulls scenario+baseline+restructuring; the
  // other two run as bare simulates (we only need their headline metrics).
  // Paid at entry, or marked paid in Activity this month (as Home reads it).
  const nowKey = countryMonthKey(profile.user.country);
  const paidEmis = [...new Set([
    ...paidAtEntryThisMonth(profile.user.loans, nowKey),
    ...(await loadPaidNowServer(profile.user.loans, nowKey)),
  ])].sort((a, b) => a - b);
  const simBaseArgs = {
    user: adjustedUser,
    horizon_months: HORIZON_MONTHS,
    marginal_rate: profile.marginalRate,
    simulation_start_month,
    // UX walkthrough fix 4: the EMIs already paid this month, so the engine's
    // owed_today is the balance Home shows (engine/owed_today.py).
    paid_emi_this_month: paidEmis.length > 0 ? paidEmis : undefined,
    reinvest_events: reinvestEvents.length > 0 ? reinvestEvents : undefined,
    inflate_expenses: inflationModeling === 'on' ? true : undefined,
    lifecycle_events: lifecycle_events.length > 0 ? lifecycle_events : undefined,
    ef_top_up_rate: efTopUpRate,
    debt_budget: debtBudget || undefined,
    low_rate_invest_share: lowRateShare || undefined,
    // Per-goal payload — engine runs serial-fill per month with
    // goal-expiry awareness, threads saved_so_far across iterations,
    // and returns per-goal slices + end-of-trajectory fill rates.
    goals: hasGoalsForEngine ? goalsForEngine : undefined,
  };
  return {
    profile,
    rolled,
    surplus,
    adjustedUser,
    application,
    fxRatesUsed,
    simulation_start_month,
    bracketTransitions,
    advanceTaxSchedule,
    advanceTaxPenaltyMonthly,
    advanceTaxNote,
    projectedTaxSavings,
    lifecycle_events,
    displayUser,
    efSplit,
    debtBudget,
    goalsForEngine,
    hasGoalsForEngine,
    simBaseArgs,
    ownInflation,
  };
}

export async function loadPlan(
  strategy: StrategyName,
  hikeModeling: HikeModeling,
  taxReinvest: TaxReinvestSetting,
  inflationModeling: InflationModeling,
  fxDrift: FxDriftSetting,
): Promise<PlanData> {
  const {
    profile,
    surplus,
    adjustedUser,
    application,
    fxRatesUsed,
    simulation_start_month,
    bracketTransitions,
    advanceTaxSchedule,
    advanceTaxPenaltyMonthly,
    advanceTaxNote,
    projectedTaxSavings,
    lifecycle_events,
    displayUser,
    efSplit,
    debtBudget,
    goalsForEngine,
    hasGoalsForEngine,
    simBaseArgs,
    ownInflation,
  } = await loadPlanInputs(hikeModeling, taxReinvest, inflationModeling, fxDrift);
  const otherStrategies = STRATEGIES.filter((s) => s !== strategy);

  // Loans missing a rate or EMI can't be projected (a blank rate read as
  // 0%), so the engine isn't run and the pages ask for the details.
  const gaps = projectionGaps(displayUser);
  // Offline or incomplete: the pages show no engine numbers from this.
  const fallback = (): PlanData => {
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
      heldBack: [],
      user: displayUser,
      configuredUser: profile.user,
      marginalRate: profile.marginalRate,
      strategy,
      hikeModeling,
      inflationModeling,
      ownInflationRate: ownInflation,
      fxDrift,
      bracketTransitions,
      advanceTaxSchedule,
      advanceTaxPenaltyMonthly,
      advanceTaxNote,
      taxReinvest,
      taxReinvestProjection: [],
      monthlyPayments: [],
      firstMonthMinimums: {},
      runArgs: null,
      activityImpact: null,
      pace: null,
      currenciesInPlay: ccyList,
      displayCurrency: userDefaultCurrency(profile.user.country),
      byCurrency: {},
      byCurrencyBaseline: {},
      fxRatesUsed: {},
      efSplit,
      debtBudget,
      goalsActive: hasGoalsForEngine,
      goalContributions: [],
      goalFinals: [],
      anyGoalShort: false,
      strategyCompare: {
        avalanche: { debtFreeMonth: null, totalInterest: '0' },
        rules: { debtFreeMonth: null, totalInterest: '0' },
        snowball: { debtFreeMonth: null, totalInterest: '0' },
      },
      // Offline mock branch — engine didn't run, no real allocation.
      surplusAllocation: null,
      shortfall: Math.max(0, -surplus),
      gaps,
    };
  };
  if (gaps.length > 0) return fallback();

  try {
    const scenarioCall = cachedEngineCall('simulate', { ...simBaseArgs, strategy }, () => api.simulate({ ...simBaseArgs, strategy }));
    // What reached the debts in the last three months as logged (lib/pace),
    // and the same plan at that average: one more run, beside the others.
    const paceWindow = monthsBefore(countryMonthKey(adjustedUser.country), PACE_MONTHS);
    const logged = paceSummary(
      (await loadActivityPaceServer()).filter((m) => paceWindow.includes(m.month)),
      profile.user.loans,
      adjustedUser.country,
      fxRatesUsed,
    );
    // The server compares repayment schedules using this plan's settings.
    // It derives balance paths there, keeping large plans within the request limit.
    const restructuringCall = scenarioCall.then(() => {
      const req = {
        user: adjustedUser,
        marginal_rate: profile.marginalRate,
        plan: { ...simBaseArgs, strategy },
      };
      return cachedEngineCall('restructuring', req, () => api.restructuring(req));
    });
    const [scenario, baseline, restructuring, ...altSims] = await Promise.all([
      scenarioCall,
      cachedEngineCall('baseline', {
        user: adjustedUser,
        horizon_months: HORIZON_MONTHS,
        lifecycle_events: lifecycle_events.length > 0 ? lifecycle_events : undefined,
      }, () => api.baseline({ user: adjustedUser, horizon_months: HORIZON_MONTHS,
        lifecycle_events: lifecycle_events.length > 0 ? lifecycle_events : undefined })),
      restructuringCall,
      ...otherStrategies.map((s) => cachedEngineCall('simulate', { ...simBaseArgs, strategy: s }, () => api.simulate({ ...simBaseArgs, strategy: s }))),
    ]);
    const strategyCompare = {
      [strategy]: {
        debtFreeMonth: shownDebtFreeMonth(scenario),
        totalInterest: scenario.total_interest_paid,
      },
      [otherStrategies[0]]: {
        debtFreeMonth: shownDebtFreeMonth(altSims[0]),
        totalInterest: altSims[0].total_interest_paid,
      },
      [otherStrategies[1]]: {
        debtFreeMonth: shownDebtFreeMonth(altSims[1]),
        totalInterest: altSims[1].total_interest_paid,
      },
    } as PlanData['strategyCompare'];
    const monthsSaved =
      shownDebtFreeMonth(scenario) && baseline.debt_free_month
        ? baseline.debt_free_month - scenario.debt_free_month!
        : 0;
    const scenarioPayments = extractMonthlyPayments(scenario);
    const baselinePayments = extractMonthlyPayments(baseline);
    const planTotal = Math.round(
      Object.entries(scenarioPayments.find((p) => p.month === 1)?.perLoan ?? {}).reduce((sum, [i, v]) => {
        const loan = displayUser.loans[Number(i)];
        return loan ? sum + (loanToUser(Number(v), loan, adjustedUser.country, fxRatesUsed) ?? 0) : sum;
      }, 0),
    );
    const paceOff = logged?.average != null && paceDiffers(logged.average, planTotal);
    const firstMinimums = Object.entries(baselinePayments.find(p => p.month === 1)?.perLoan ?? {}).reduce((sum, [i, v]) => {
      const loan = displayUser.loans[Number(i)];
      return sum + (loan ? loanToUser(Number(v), loan, adjustedUser.country, fxRatesUsed) ?? 0 : 0);
    }, 0);
    let projectionUnavailable: NonNullable<PlanData['pace']>['projectionUnavailable'];
    let paceSim: SimulateResponse | null = null;
    if (logged?.average != null) {
      if (logged.average < firstMinimums - 0.5) projectionUnavailable = 'below_minimums';
      else if (paceOff) {
        const paceArgs = { ...simBaseArgs, strategy, debt_budget: String(logged.average) };
        paceSim = String(logged.average) === debtBudget ? scenario
          : await cachedEngineCall('simulate', paceArgs, () => api.simulate(paceArgs)).catch(() => null);
        if (!paceSim) projectionUnavailable = 'failed';
        else {
          projectionUnavailable = paceProjectionGap(paceSim.trajectory, paceSim.debt_free_month, logged.average!);
        }
      }
    }
    const ccyList = currenciesInPlay(displayUser.loans, adjustedUser.country);
    const byCurrency = derivePerCurrencyMetrics(
      displayUser.loans,
      scenarioPayments,
      adjustedUser.country,
    );
    const byCurrencyBaseline = derivePerCurrencyMetrics(
      displayUser.loans,
      baselinePayments,
      adjustedUser.country,
    );
    return {
      nonAmortising: (scenario.non_amortising ?? []).map((b) => ({
        loanIndex: b.loan_index,
        monthlyInterest: Number(b.monthly_interest),
        scheduledEmi: Number(b.scheduled_emi),
      })),
      // Integration phase 5 (C11): debtFreeMonth / infeasibleFrom /
      // scheduleCut from one mapping (lib/plan-gap planEnd): a capped plan
      // has no debt-free month and stops at its first unfundable month.
      ...planEnd(scenario),
      seasonal: scenario.seasonal ?? null,
      owedToday: owedTodayOf(scenario),
      baselineNeverClears: !!baseline.never_clears || (baseline.debt_free_month == null && Number(baseline.total_interest_paid) > 0),
      trajectory: mergeTrajectories(scenario, baseline),
      totalInterest: scenario.total_interest_paid,
      baselineInterest: baseline.total_interest_paid,
      monthsSaved,
      live: true,
      profileIsLive: profile.isLive,
      surplus,
      opportunities: restructuring.opportunities,
      totalAnnualSaving: restructuring.total_annual_saving,
      heldBack: restructuring.held_back ?? [],
      user: displayUser,
      configuredUser: profile.user,
      marginalRate: profile.marginalRate,
      strategy,
      hikeModeling,
      inflationModeling,
      ownInflationRate: ownInflation,
      fxDrift,
      bracketTransitions,
      advanceTaxSchedule,
      advanceTaxPenaltyMonthly,
      advanceTaxNote,
      taxReinvest,
      taxReinvestProjection: projectedTaxSavings,
      monthlyPayments: scenarioPayments,
      // What the pay-minimums run pays in month 1: the plan's month-1
      // payment minus this is the extra it puts on each loan.
      firstMonthMinimums: baselinePayments.find((p) => p.month === 1)?.perLoan ?? {},
      debtStatusMonth1: ((p) => ({ catchUp: p?.catch_up_by_loan_index ?? {}, pot: p?.settlement_pot_by_loan_index ?? {} }))(
        scenario.trajectory.find((p) => p.month === 1)),
      runArgs: simBaseArgs,
      // Only when the log changed a balance: an extra the plan already
      // pays this month changes nothing until the month is over.
      activityImpact:
        application.entryCount > 0 && application.perLoanBumps.some((b) => Number(b.totalBump) !== 0)
          ? {
              perLoanBumps: application.perLoanBumps,
              totalBump: application.totalBump,
              entryCount: application.entryCount,
            }
          : null,
      pace: logged
        ? {
            ...logged,
            planTotal,
            differs: paceOff,
            projectionUnavailable,
            debtFreeMonth: paceOff && paceSim && !projectionUnavailable ? shownDebtFreeMonth(paceSim) : null,
          }
        : null,
      currenciesInPlay: ccyList,
      displayCurrency: userDefaultCurrency(adjustedUser.country),
      byCurrency,
      byCurrencyBaseline,
      fxRatesUsed,
      efSplit,
      debtBudget,
      goalsActive: hasGoalsForEngine,
      goalContributions:
        scenario.surplus_allocation?.goal_contributions?.map((c) => ({
          goalId: c.goal_id,
          amount: Number(c.amount),
          runRate: Number(c.run_rate),
          queuedReason:
            (c.queued_reason as
              | 'past_date'
              | 'over_funded'
              | 'surplus_exhausted'
              | 'partial_fill'
              | 'deferred'
              | null) ?? null,
          fundingStartMonthIndex: c.funding_start_month_index ?? null,
        })) ?? [],
      goalFinals:
        scenario.goal_finals?.map((f) => ({
          goalId: f.goal_id,
          required: Number(f.required),
          savedAtTarget: Number(f.saved_at_target),
          fillRate: Number(f.fill_rate),
          targetReached: f.target_reached,
          targetPastHorizon: f.target_past_horizon === true,
          funded: f.funded,
        })) ?? [],
      anyGoalShort: !!scenario.surplus_allocation?.any_goal_short,
      strategyCompare,
      surplusAllocation: scenario.surplus_allocation
        ? {
            surplus: Number(scenario.surplus_allocation.surplus),
            goalSlice: Number(scenario.surplus_allocation.goal_slice),
            efSlice: Number(scenario.surplus_allocation.ef_slice),
            debtSlice: Number(scenario.surplus_allocation.debt_slice),
            efPreempted: scenario.surplus_allocation.ef_preempted,
            efSplit: Number(scenario.surplus_allocation.ef_split),
          }
        : null,
      shortfall: Number(scenario.shortfall ?? 0),
      payoffOrderNote: scenario.payoff_order_note ?? null,
      futureShortfall: (() => {
        const row=scenario.trajectory.find(p=>p.month>1 && Number(p.shortfall)>0);
        return row ? {month:row.month,amount:Number(row.shortfall)} : undefined;
      })(),
      gap: planGap(scenario),
      gaps: [],
    };
  } catch {
    return fallback();
  }
}


/** Load the plan with the user's saved settings (strategy and toggles). */
export async function loadPlanFromCookies(): Promise<PlanData> {
  const [strategy, hikeModeling, taxReinvest, inflationModeling, fxDrift] =
    await Promise.all([
      loadStrategyServer(),
      loadHikeModelingServer(),
      loadTaxReinvestServer(),
      loadInflationModelingServer(),
      loadFxDriftServer(),
    ]);
  return loadPlan(strategy, hikeModeling, taxReinvest, inflationModeling, fxDrift);
}

/** The plan's inputs and strategy from the cookies, without running it. */
export async function loadPlanInputsFromCookies() {
  const [strategy, hikeModeling, taxReinvest, inflationModeling, fxDrift] =
    await Promise.all([
      loadStrategyServer(),
      loadHikeModelingServer(),
      loadTaxReinvestServer(),
      loadInflationModelingServer(),
      loadFxDriftServer(),
    ]);
  return { strategy, ...(await loadPlanInputs(hikeModeling, taxReinvest, inflationModeling, fxDrift)) };
}

/** What one payoff order comes to on the plan's own inputs. */
export interface StrategyOutcome {
  debtFreeMonth: number | null;
  totalInterest: string;
  /** Some month is short of cash, so this order has no date to plan by. */
  short: boolean;
}

/**
 * The three payoff orders run on the same inputs as Plan (Profile's
 * side-by-side, REDESIGN R6.3), so each number matches what Plan shows
 * when that order is picked. Null when there's nothing to order: no debt,
 * or a loan missing the rate or EMI the engine needs.
 */
export async function loadStrategyOutcomesFromCookies(): Promise<{
  active: StrategyName;
  country: UserPayload['country'];
  outcomes: Record<StrategyName, StrategyOutcome>;
} | null> {
  const { strategy, displayUser, simBaseArgs } = await loadPlanInputsFromCookies();
  if (!displayUser.loans.some((l) => Number(l.outstanding) > 0)) return null;
  if (projectionGaps(displayUser).length > 0) return null;
  const sims = await Promise.all(STRATEGIES.map((s) => cachedEngineCall('simulate', { ...simBaseArgs, strategy: s }, () => api.simulate({ ...simBaseArgs, strategy: s }))));
  const outcomes = Object.fromEntries(
    STRATEGIES.map((s, i) => [
      s,
      {
        debtFreeMonth: shownDebtFreeMonth(sims[i]),
        totalInterest: sims[i].total_interest_paid,
        short:
          Number(sims[i].shortfall ?? 0) > 0 ||
          sims[i].trajectory.some((p) => p.month > 1 && Number(p.shortfall) > 0),
      },
    ]),
  ) as Record<StrategyName, StrategyOutcome>;
  return { active: strategy, country: displayUser.country, outcomes };
}
