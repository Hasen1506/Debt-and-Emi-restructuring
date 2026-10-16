/**
 * Plan insights (audit 80+ A1, A2, A4, A5, A6, "Don't sign that").
 *
 * The engine does the work (engine/plan_insights.py, consolidation.py,
 * prepay_invest.py, offer_check.py; routes in api/routes/insights.py).
 * This file holds the request/response shapes, the calls, and the few pure
 * decisions the screens make from them (A2: ask about the order or not).
 */
import { postEngineWithFieldErrors as post, type SimulateArgs } from './api';
import type { StrategyName } from './strategy';

export interface LoanCheckFindingBody {
  kind: 'old_benchmark' | 'missed_rate_cut';
  amount_this_year: string;
  overcharged_so_far?: string;
  lender?: string | null;
  loan_index?: number | null;
}

export interface InsightsArgs extends SimulateArgs {
  simulation_start_year?: number;
  loan_check_findings?: LoanCheckFindingBody[];
  consolidation_rate?: string;
  consolidation_tenure_months?: number;
  consolidation_fee_pct?: string;
  consolidation_foreclosure_pct?: string;
}

export interface OrderRun { strategy: string; net_cost: string; interest: string; debt_free_month: number | null }
export interface OrderSpread {
  runs: OrderRun[];
  cheapest: string;
  spread: string;
  threshold: string;
  months_apart: number;
  material: boolean;
  line: string;
}
export interface Disagreement {
  kind: 'order' | 'consolidation' | 'old_benchmark' | 'missed_rate_cut';
  worth: string;
  basis: 'over_plan' | 'this_year';
  headline: string;
  detail: string;
  reasons: string[];
  loan_index: number | null;
}
export interface Disagreements {
  items: Disagreement[];
  total_over_plan: string;
  plain_order: number[];
  rightdue_order: number[];
  zero_line: string | null;
}
export interface GapWay {
  kind: 'consolidate' | 'stretch' | 'spend';
  monthly: string;
  closes: string;
  closes_all: boolean;
  headline: string;
  detail: string;
  extra_cost: string | null;
  loan_index: number | null;
}
export interface GapHeadlineData { gap: string; ways: GapWay[]; closed_debt_free_month: number | null }
export interface ConsolidationScenario {
  rate: string;
  rate_basis: 'yours' | 'typical' | 'high';
  tenure_months: number;
  card_indices: number[];
  card_total: string;
  principal: string;
  fee: string;
  fee_gst: string;
  emi: string;
  card_minimum_now: string;
  cash_freed: string;
  gap_before: string;
  gap_after: string;
  debt_free_before: number | null;
  debt_free_after: number | null;
  cost_before: string;
  cost_after: string;
  saving: string;
  payments_share_after: string | null;
  verdict: 'saves' | 'frees_cash_costs_more' | 'costs_more';
  break_even_fee_pct: string | null;
  cost_window_months: number | null;
}
export interface PublishedRates { typical: string; high: string | null; banks: number; period: string; as_of: string; sources: [string, string][] }
export interface ConsolidationData {
  cards: number[];
  card_cost: Record<string, string>;
  scenarios: ConsolidationScenario[];
  published: PublishedRates | null;
  neutrality: string;
  /** UX walkthrough fix 1: the plan month the cards clear in, and why the
   *  move isn't advice on this plan (null: it is). */
  plan_clears_month?: number | null;
  not_worth_it?: 'plan_clears' | 'costs_more' | null;
}
export interface PlanInsights {
  order: OrderSpread | null;
  disagreements: Disagreements;
  gap: GapHeadlineData | null;
  consolidation: ConsolidationData | null;
  low_rate_phase_month: number | null;
  low_rate_threshold: string;
  /** Round 2: threshold = this return (the user's, or the default) + margin. */
  low_rate_assumed_return?: string | null;
  low_rate_assumption_is_default?: boolean;
  low_rate_margin?: string;
}
export interface PrepayOption {
  share_kept: string;
  debt_free_month: number | null;
  interest_paid: string;
  kept_by_debt_free: string;
  money_on_common_date: string | null;
}
export interface PrepayInvestData {
  available: boolean;
  phase_month: number | null;
  phase_loans: number[];
  extra_then: string | null;
  loan_costs: Record<string, string>;
  threshold: string;
  /** Round 2: the return behind the threshold, and whether it is the default. */
  assumed_return_for_trigger?: string | null;
  assumption_is_default?: boolean;
  common_month: number | null;
  assumed_return: string | null;
  options: PrepayOption[];
  break_even_return: string | null;
  statement: string;
}
export interface OfferBody {
  kind: 'top_up' | 'personal_loan' | 'no_cost_emi';
  purpose: 'repay' | 'spend';
  amount: string;
  tenure_months: number;
  rate?: string;
  fee_pct?: string;
  fee_flat?: string;
  foreclosure_pct?: string;
  floating?: boolean;
  monthly_emi?: string;
  cash_price?: string;
  repay_indices?: number[];
}
export interface OfferCheckData {
  apr: string;
  monthly_emi: string;
  fee_total: string;
  total_cost: string;
  comparisons: { against: string; label: string; cost_difference: string | null; detail: string }[];
  debt_free_before: number | null;
  debt_free_after: number | null;
  gap_before: string;
  gap_after: string;
  payments_share: string | null;
  verdict: 'checks_out' | 'costs_more' | 'doesnt_fit';
  headline: string;
  notes: string[];
  neutrality: string;
}

/** The insights body from a plan's /simulate arguments. */
export function insightsArgs(run: SimulateArgs, startYear: number, extra: Partial<InsightsArgs> = {}): InsightsArgs {
  return { ...run, simulation_start_year: startYear, ...extra };
}

export const fetchPlanInsights = (a: InsightsArgs) => post<PlanInsights>('/api/insights/plan', a);
export const fetchPrepayInvest = (a: InsightsArgs & { assumed_return?: string }) =>
  post<PrepayInvestData>('/api/insights/prepay-invest', a);
export const fetchConsolidation = (a: InsightsArgs) => post<ConsolidationData | null>('/api/insights/consolidation', a);
export const fetchOfferCheck = (a: InsightsArgs & { offer: OfferBody }) => post<OfferCheckData>('/api/insights/offer-check', a);

/**
 * A2: whether Setup asks for a payoff order. Asked only when the orders
 * differ by more than max(₹500, 0.5% of interest) or by a month; otherwise
 * the cheapest is picked and the screen says all orders give the same result.
 * With no answer from the engine (yet), Setup asks as before.
 */
export function orderChoice(order: OrderSpread | null | undefined): { ask: boolean; preselect: StrategyName | null; line: string | null } {
  // undefined: no answer from the engine; null: fewer than two loans, so no order to choose.
  if (order === undefined) return { ask: true, preselect: null, line: null };
  if (order === null) return { ask: false, preselect: 'avalanche', line: 'With one loan there is no order to choose.' };
  const cheapest: StrategyName = order.cheapest === 'snowball' ? 'snowball' : 'avalanche';
  if (!order.material) return { ask: false, preselect: cheapest, line: order.line };
  return { ask: true, preselect: null, line: order.line };
}

/** The A1 headline figure, or null when there's nothing to claim. */
export function disagreementTotal(d: Disagreements | null | undefined): number | null {
  if (!d || d.items.length === 0) return null;
  const n = Number(d.total_over_plan);
  return Number.isFinite(n) && n > 0 ? n : null;
}
