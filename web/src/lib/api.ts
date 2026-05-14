/**
 * Typed client for the FastAPI gateway. Decimals come over as strings;
 * call sites convert with decimal.js when arithmetic is needed and with
 * `formatINR` / `formatUSD` for display.
 */
import Decimal from 'decimal.js';

const BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:8000';

// ─── shared types ───────────────────────────────────────────────────────────

export type Country = 'IN' | 'US';
export type Strategy = 'avalanche' | 'hybrid' | 'snowball';
export type LoanType =
  | 'home_loan'
  | 'auto_loan'
  | 'personal_loan'
  | 'credit_card'
  | 'education_loan'
  | 'gold_loan'
  | 'bnpl';
export type LiquidityClass = 'liquid' | 'locked' | 'age_gated';
export type IncomeType = 'salaried' | 'business_owner';
export type TaxRegimeIN = 'new' | 'old';

export interface LoanPayload {
  loan_type: LoanType;
  bank: string;
  outstanding: string;
  nominal_rate: string;
  rate_type: 'floating' | 'fixed';
  tenure_months_remaining: number;
  scheduled_emi: string;
  processing_fee_amortised?: string;
  insurance_premium_pct?: string;
  property_use?: string;
}

export interface InvestmentOptionPayload {
  name: string;
  expected_return: string;
  liquidity_class: LiquidityClass;
  is_in_pool?: boolean;
}

export interface UserPayload {
  country: Country;
  income_type: IncomeType;
  annual_income: string;
  monthly_income: string;
  fixed_expenses: string;
  savings_balance: string;
  primary_bank: string;
  location_tier?: string;
  tax_regime?: TaxRegimeIN;
  efund_balance?: string;
  efund_target?: string;
  loans: LoanPayload[];
  investment_options?: InvestmentOptionPayload[];
  annual_hike_rate?: string;
  inflation_rate?: string;
}

// ─── response types ─────────────────────────────────────────────────────────

export interface TrajectoryPointRaw {
  month: number;
  balance: string;
  interest_paid: string;
  invested: string;
}

export interface SimulateResponse {
  debt_free_month: number | null;
  total_interest_paid: string;
  total_invested: string;
  trajectory: TrajectoryPointRaw[];
  months_in_horizon: number;
}

export interface CompareResponse {
  baseline_debt_free_month: number | null;
  scenario_debt_free_month: number | null;
  months_pulled_forward: string;
  interest_saved: string;
  extra_invested: string;
}

export interface NewDebtResponse {
  list_price: string;
  cash_price: string;
  foregone_discount: string;
  processing_fee: string;
  total_real_cost: string;
  monthly_emi: string;
  effective_apr: string;
  verdict: 'take' | 'pay_cash' | 'delay';
  detail: string;
}

export interface WindfallResponse {
  loan_label: string;
  amount: string;
  rationale: string;
  interest_avoided: string;
  invest_instead: boolean;
  investment_name: string | null;
}

export interface QuickRecomputeResponse {
  old_debt_free_month: number | null;
  new_debt_free_month: number | null;
  months_pulled_forward: number;
  interest_saved: string;
}

export interface CashYieldResponse {
  alert: boolean;
  idle_balance: string | null;
  current_yield: string | null;
  best_alt_yield: string | null;
  alt_name: string | null;
  annual_uplift: string | null;
  beats_top_loan: boolean | null;
  rationale: string | null;
}

export interface BorrowTimingResponse {
  current_rate: string;
  six_month_avg: string;
  consensus_change_bps: number;
  months_to_decision: number;
  urgency: string;
  verdict: 'borrow_now' | 'wait';
  estimated_savings: string;
  detail: string;
}

export interface AssetPayload {
  asset_type: string;
  purchase_price: string;
  purchase_date: string;                // YYYY-MM-DD
  current_market_value: string;
  rental_income_annual?: string;
  holding_costs_annual?: string;
  state?: string;
}

export interface AssetLiquidationResponse {
  net_proceeds: string;
  ltcg_tax: string;
  net_benefit: string;
  asset_real_return_net: string;
  gate_1_net_benefit: boolean;
  gate_2_high_rate: boolean;
  gate_3_spread: boolean;
  gate_0_wealth_edge: boolean | null;
  surplus: string | null;
  wealth_hold: string | null;
  wealth_sell: string | null;
  wealth_edge: string | null;
  horizon_years: string | null;
  recommend_liquidation: boolean;
  rationale: string;
}

export interface FxRateResponse {
  base: string;
  quote: string;
  rate: string;
  source: 'frankfurter' | 'manual' | 'fallback';
  as_of: string | null;
}

export type ScoreAction =
  | 'hard_inquiry'
  | 'utilisation_drop'
  | 'balance_transfer'
  | 'new_account'
  | 'close_oldest_card'
  | 'on_time_streak_quarter'
  | 'loan_paid_off'
  | 'card_paid_off';

export type ScoreBand = 'poor' | 'fair' | 'good' | 'very_good' | 'excellent';

export interface ScoreImpactResponse {
  action: ScoreAction;
  current_score: number;
  current_band: ScoreBand;
  delta_low: number;
  delta_high: number;
  projected_score_low: number;
  projected_score_high: number;
  projected_band_low: ScoreBand;
  projected_band_high: ScoreBand;
  days_to_realise: number;
  source: string;
  rationale: string;
}

export interface RateOfferedResponse {
  advertised_rate: string;
  offered_rate: string;
  spread: string;
  band: ScoreBand;
}

export type RestructuringKind = 'balance_transfer' | 'consolidation' | 'refinance';

export interface RestructuringOpportunity {
  kind: RestructuringKind;
  headline: string;
  rationale: string;
  estimated_annual_saving: string;
  affected_loan_banks: string[];
  target_bank: string | null;
  target_rate: string;
  current_rate: string;
  detail: Record<string, string>;
}

export interface RestructuringResponse {
  opportunities: RestructuringOpportunity[];
  total_annual_saving: string;
}

export interface CrossBorderResponse {
  fx_rate_used: string;
  fx_drift_used: string;
  effective_loan_cost_in_user_currency: string;
  user_post_tax_yield: string;
  spread: string;
  verdict: 'prepay' | 'invest' | 'marginal';
  rationale: string;
  loan_emi_user_currency: string;
  loan_emi_user_currency_y5: string;
}

// ─── thin fetch helper ──────────────────────────────────────────────────────

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`${path} → ${res.status}: ${detail}`);
  }
  return res.json() as Promise<T>;
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

// ─── endpoints ──────────────────────────────────────────────────────────────

export const api = {
  health: () => get<{ status: string }>('/api/health'),

  simulate: (req: {
    user: UserPayload;
    strategy?: Strategy;
    horizon_months?: number;
    matched_contribution?: string;
    marginal_rate?: string;
    simple_mode?: boolean;
  }) => post<SimulateResponse>('/api/simulate', req),

  baseline: (req: {
    user: UserPayload;
    horizon_months?: number;
    simple_mode?: boolean;
  }) => post<SimulateResponse>('/api/baseline', req),

  sensitivity: (req: {
    user: UserPayload;
    horizon_months?: number;
    marginal_rate?: string;
    strategy?: Strategy;
    surplus_delta?: string;
    income_shock_months?: number;
    rate_shock_delta?: string;
    rate_shock_floating_only?: boolean;
    alt_strategy?: Strategy;
    lump_sum_amount?: string;
    lump_sum_target_loan_index?: number;
  }) => post<CompareResponse>('/api/sensitivity/compare', req),

  newDebt: (req: {
    list_price: string;
    cash_price_elsewhere: string;
    emi_offer_months: number;
    emi_offer_monthly_payment: string;
    processing_fee?: string;
    user_savings_after_efund?: string;
  }) => post<NewDebtResponse>('/api/new-debt', req),

  windfall: (req: {
    amount: string;
    user: UserPayload;
    marginal_rate?: string;
    strategy?: Strategy;
  }) => post<WindfallResponse>('/api/windfall', req),

  quickRecompute: (req: {
    user: UserPayload;
    extra_payment: string;
    target_loan_index?: number;
    strategy?: Strategy;
    horizon_months?: number;
    marginal_rate?: string;
  }) => post<QuickRecomputeResponse>('/api/quick-recompute', req),

  cashYield: (req: {
    idle_balance: string;
    current_yield: string;
    country: Country;
    top_loan_effective_rate?: string;
    best_alt_yield?: string;
    alt_name?: string;
    minimum_idle_threshold?: string;
  }) => post<CashYieldResponse>('/api/cash-yield', req),

  rightTime: (req: {
    current_rate: string;
    six_month_avg: string;
    consensus_change_bps: number;
    months_to_decision: number;
    urgency: 'now' | '3m_ok' | '6m_ok';
    principal: string;
    tenure_months: number;
  }) => post<BorrowTimingResponse>('/api/right-time-to-borrow', req),

  scoreImpact: (req: {
    action: ScoreAction;
    current_score: number;
    country?: string;
    utilisation_from?: string;
    utilisation_to?: string;
    is_only_instalment_loan?: boolean;
    has_thin_file?: boolean;
  }) => post<ScoreImpactResponse>('/api/score-impact', req),

  rateOffered: (req: {
    advertised_rate: string;
    score: number;
    loan_type: string;
    country?: string;
  }) => post<RateOfferedResponse>('/api/rate-offered', req),

  fxRate: (base: string, quote: string) =>
    get<FxRateResponse>(`/api/fx-rate?base=${base}&quote=${quote}`),

  crossBorder: (req: {
    loan_balance: string;
    loan_nominal_rate: string;
    loan_tenure_months: number;
    loan_currency: string;
    user_currency: string;
    user_savings_yield: string;
    user_marginal_tax?: string;
    manual_fx_rate?: string;
    manual_fx_drift_annual?: string;
    inflation_user_country?: string;
  }) => post<CrossBorderResponse>('/api/cross-border-decision', req),

  restructuring: (req: {
    user: UserPayload;
    marginal_rate?: string;
  }) => post<RestructuringResponse>('/api/restructuring', req),

  assetLiquidation: (req: {
    asset: AssetPayload;
    sale_price: string;
    debt_balance: string;
    debt_effective_rate: string;
    taxable_income: string;
    asset_nominal_return?: string;
    inflation?: string;
    holding_cost_rate?: string;
    expected_hold_years_post_sale?: string;
    selling_period_months?: number;
    high_rate_threshold?: string;
    purchase_fy?: string;
    current_fy?: string;
    brokerage_rate?: string;
    surplus_reinvestment_yield?: string;
  }) => post<AssetLiquidationResponse>('/api/asset-liquidation', req),
};

// ─── formatting helpers ─────────────────────────────────────────────────────

export function formatINR(value: string | number | Decimal): string {
  const d = new Decimal(value);
  const abs = d.abs();
  if (abs.gte(10_000_000)) return `₹${d.div(10_000_000).toFixed(2)}Cr`;
  if (abs.gte(100_000)) return `₹${d.div(100_000).toFixed(2)}L`;
  if (abs.gte(1_000)) return `₹${d.div(1_000).toFixed(1)}k`;
  return `₹${d.toFixed(0)}`;
}

export function formatUSD(value: string | number | Decimal): string {
  const d = new Decimal(value);
  const abs = d.abs();
  if (abs.gte(1_000_000)) return `$${d.div(1_000_000).toFixed(2)}M`;
  if (abs.gte(1_000)) return `$${d.div(1_000).toFixed(1)}k`;
  return `$${d.toFixed(2)}`;
}

export function formatCurrency(value: string | number | Decimal, currency: string): string {
  return currency.toUpperCase() === 'USD' ? formatUSD(value) : formatINR(value);
}

export function formatPct(value: string | number | Decimal, digits = 2): string {
  return `${new Decimal(value).mul(100).toFixed(digits)}%`;
}

export function monthIndexToLabel(
  monthIndex: number | null,
  start: Date = new Date(),
): string {
  if (monthIndex === null) return '—';
  const d = new Date(start.getFullYear(), start.getMonth() + monthIndex, 1);
  return d.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
}
