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
import type { HikeModeling } from '@/lib/hike-modeling';
import type { TaxReinvestSetting } from '@/lib/tax-reinvest';
import type { InflationModeling } from '@/lib/inflation-modeling';
import type { FxDriftSetting } from '@/lib/fx-drift';
import type { BracketTransition } from '@/lib/bracket-transitions';
import type { AdvanceTaxSchedule } from '@/lib/advance-tax';
import type { CurrencyCode, PerCurrencyMetrics } from '@/lib/currency';

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

/**
 * Summary of how the user's activity ledger bumped the projection.
 *
 * Populated when the activity cookie carries one or more missed/partial
 * events. The Plan page surfaces this as a banner so the user knows their
 * trajectory reflects real history, not the optimistic onboarding numbers.
 */
export interface ActivityImpact {
  /** Per-loan: how much the outstanding was bumped, and how many entries
   *  contributed. Sorted by bump descending. */
  perLoanBumps: { loanIndex: number; totalBump: string; entryCount: number }[];
  /** Sum across all loans. '0' when there's nothing to apply. */
  totalBump: string;
  /** Count of contributing activity entries. */
  entryCount: number;
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
  /** Whether the projection modelled the user's expected annual hike or
   *  treated income as flat. Set by the per-plan toggle. */
  hikeModeling: HikeModeling;
  /** Whether the projection inflates expenses month-over-month at
   *  user.inflation_rate. Set by the per-plan toggle. When 'on', surplus
   *  erodes over time → debt-free month pushes out. */
  inflationModeling: InflationModeling;
  /** Whether the projection applies FX drift to non-residence-currency
   *  loans. Set by the per-plan toggle. Only meaningful for hybrid users
   *  (currenciesInPlay.length > 1); single-currency users see no UI. */
  fxDrift: FxDriftSetting;
  /** Tax-bracket transitions the user crosses during the horizon as
   *  their hike trajectory grows gross income. Empty when no gross
   *  income provided OR hike toggle is off OR user stays in same slab. */
  bracketTransitions: BracketTransition[];
  /** Quarterly advance-tax schedule for SE users above the Sec 208 /
   *  1040-ES threshold. null when not applicable (salaried users, SE
   *  users with no gross income provided, or liability under threshold). */
  advanceTaxSchedule: AdvanceTaxSchedule | null;
  /** Monthly cost the advance-tax penalty adds to the user's surplus
   *  computation. Zero when paid up or schedule is null. Non-zero values
   *  reduce available surplus → debt-free month pushes out. Surfaced in
   *  the panel as "penalty is costing you ~₹X/mo" for visibility. */
  advanceTaxPenaltyMonthly: number;
  /** Auto-reinvest tax-savings toggle. When 'on', the simulation includes
   *  per-year reinvest events routed to the highest-effective-APR loan.
   *  See [[lib/tax-reinvest]] and `taxReinvestProjection` below. */
  taxReinvest: TaxReinvestSetting;
  /** Year-by-year tax-saving events that were sent to the engine when
   *  taxReinvest === 'on'. Empty when the toggle is off OR no loans
   *  qualify (e.g. India new-regime user with no education loan).
   *  Components use this to render the "reinvest schedule" summary
   *  alongside the toggle. */
  taxReinvestProjection: { month: number; amount: string }[];
  /** Month-by-month per-loan payments for the active strategy. Empty when
   *  the engine call falls back to mock data (offline mode). */
  monthlyPayments: MonthlyPaymentBreakdown[];
  /** Summary of activity-ledger deltas applied to the projection. Null
   *  when no missed/partial events are recorded. */
  activityImpact: ActivityImpact | null;
  /** Currencies represented in the loan list, user-default first. Usually
   *  a single element; length > 1 only for NRI-US users with hybrid debts. */
  currenciesInPlay: CurrencyCode[];
  /** Primary display currency — what the user's country defaults to. KPIs
   *  fall back to this when an aggregate spans currencies. */
  displayCurrency: CurrencyCode;
  /** Per-currency breakdown of scenario aggregates derived from the
   *  per-loan payment trail. Populated for every currency in play
   *  (including single-currency users — components can ignore it). */
  byCurrency: Partial<Record<CurrencyCode, PerCurrencyMetrics>>;
  /** Same per-currency derivation against the minimums-only baseline.
   *  Lets us show "interest saved" per currency cleanly. */
  byCurrencyBaseline: Partial<Record<CurrencyCode, PerCurrencyMetrics>>;
  /** FX rates the server used for this run (loan-ccy → user-ccy). Passed
   *  down so the client can write the cache cookie via useEffect — server
   *  components can't set cookies during render, so we round-trip the
   *  freshly-fetched rates through the client. Empty for single-currency
   *  users. */
  fxRatesUsed: Record<string, string>;
  /** Current EF / debt split (e.g. '0.30' = 30% EF, 70% debt). Default
   *  0.30 preserves the pre-slider behaviour. Read from the ef_split
   *  cookie at request time. */
  efSplit: string;
  /** User's chosen plan-start (YYYY-MM), empty = "today". Anchors the
   *  simulation_start_month and is surfaced via the PlanStartPicker. */
  planStart: string;
  /** True when at least one active goal has preempts_ef=true, meaning
   *  EF top-up is paused for the current horizon. Drives an assumption
   *  chip + the EF slider's disabled state. */
  efPreempted: boolean;
}
