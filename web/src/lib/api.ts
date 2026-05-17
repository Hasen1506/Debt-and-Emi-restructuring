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
export type FilingStatusUS = 'single' | 'mfj' | 'hoh';

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
  /** Optional user override for credit-card minimum payment. When set, the
   *  bank-specific formula is bypassed. Ignored for non-card loans. */
  min_payment_override?: string;
  /** Currency the loan is denominated in. Omit when the loan currency
   *  matches user.country (INR for IN-resident, USD for US-resident). Set
   *  explicitly for cross-currency cases — e.g. an NRI on a US work visa
   *  servicing an Indian home loan tags it `currency: 'INR'`. */
  currency?: 'INR' | 'USD';
  /** Credit cards only: expected new charges per month. The simulator
   *  bumps outstanding by this before each min-payment calc, modelling
   *  "user keeps using the card" rather than freeze-and-pay-off. Default
   *  '0' for backwards compatibility. Ignored on non-card loans. */
  expected_monthly_spend?: string;
}

export interface InvestmentOptionPayload {
  name: string;
  expected_return: string;
  liquidity_class: LiquidityClass;
  is_in_pool?: boolean;
}

/** Coarse age band — used for downstream nudges (retirement check at 50+,
 *  emergency-fund-first at <25). Never use exact age; the band is enough. */
export type AgeBracket = 'under_25' | '25_35' | '35_50' | '50_plus';

export interface UserPayload {
  country: Country;
  income_type: IncomeType;
  /** Optional display name shown in the app greeting ("Hi, Hasen"). Not
   *  consumed by the engine — pure UI label. Empty / omitted is fine. */
  display_name?: string;
  /** Optional age bracket — used for life-stage-aware suggestions. Not
   *  consumed by the engine. */
  age_bracket?: AgeBracket;
  annual_income: string;
  monthly_income: string;
  fixed_expenses: string;
  /** Discretionary monthly outflows — eating out, travel, shopping. What
   *  the user could cut if they had to. Optional; older profiles default
   *  to "0" and the engine subtracts both this and fixed_expenses from
   *  income to derive available surplus. */
  variable_expenses?: string;
  /** Annual pre-tax salary for salaried users — the gross number on the
   *  offer letter / Form 16 line 1, before TDS and 80C/80D deductions but
   *  AFTER subtracting employer PF, gratuity, and insurance from CTC.
   *  Optional; when present we derive marginal_rate + bracket info from
   *  it (otherwise the manual marginal_rate field takes over). */
  annual_gross_salary?: string;
  /** Annual business income for self-employed users — the "Total Income"
   *  line from last filed ITR-3/ITR-4 (revenue − expenses − depreciation).
   *  Optional; same role as annual_gross_salary on the SE side. */
  annual_business_income?: string;
  /** Self-reported credit score — CIBIL (300-900) for India, FICO (300-850)
   *  for US. Optional. Drives the rate-prediction chip in setup: a higher
   *  score moves the predicted rate down inside the bank's published range
   *  (banks reserve the lower-end of their range for high-tier borrowers).
   *  Treated as a string for parity with other numeric fields entered in
   *  free-text inputs. */
  credit_score?: string;
  savings_balance: string;
  primary_bank: string;
  location_tier?: string;
  /** Banks the user holds savings/current accounts at without an active
   *  loan. Used by new-debt / refinance suggestions to prefer existing
   *  banking relationships over new account opens. */
  other_banks?: string[];
  tax_regime?: TaxRegimeIN;
  /** US filing status — drives which slab table applies. Defaults to
   *  'single' if omitted. */
  filing_status?: FilingStatusUS;
  /** Optional US state marginal rate as decimal — e.g. '0.0682' for
   *  California top bracket. Added to federal marginal_rate when present
   *  so combined effective-rate math reflects state burden. */
  state_marginal_rate?: string;
  efund_balance?: string;
  efund_target?: string;
  loans: LoanPayload[];
  /** Optional list of assets for the portfolio-liquidation advisor. Each entry
   *  is partially-optional; minimum needed is asset_type + current_market_value
   *  + purchase_date (year-only OK). */
  assets?: AssetPayload[];
  investment_options?: InvestmentOptionPayload[];
  annual_hike_rate?: string;
  /** Calendar month (1-12) when the annual hike fires. Defaults to 1 (Jan)
   *  if omitted; IN onboarding defaults to 4 (FY-1, April). */
  hike_effective_month?: number;
  /** Optional hike phases for varied year-by-year rates. Each tuple is
   *  [yearFrom (1-based inclusive), yearTo (1-based exclusive), rate (decimal)].
   *  Example: [[1, 3, "0.07"], [3, 7, "0.10"]] = 7% in years 1-2, 10% in
   *  years 3-6, fallback to annual_hike_rate after. Empty / omitted →
   *  engine uses annual_hike_rate uniformly. */
  hike_schedule?: [number, number, string][];
  inflation_rate?: string;
  /** NRI on a US work visa (tax-resident in US, may hold INR debts). When
   *  true, the UI threads dual-currency context through debt views and the
   *  NRI-prepay tool autofills FX/currency fields from the profile. */
  is_nri_us?: boolean;
  /** FX rate per loan currency, expressed as "units of residence currency
   *  per 1 unit of loan currency" — same direction as /api/fx-rate. Used
   *  by the engine to convert non-residence-currency EMIs into residence
   *  currency before summing into the surplus / DTI calculation. Empty
   *  dict is the safe default (parity, so the helper is a no-op). */
  fx_to_user_currency?: Record<string, string>;
  /** Annualized FX drift per non-residence currency. When non-empty, the
   *  engine compounds drift into the FX rate each month so long-horizon
   *  loans denominated in a different currency see year-over-year
   *  appreciation/depreciation. Wired up by the /plan FX-drift toggle
   *  (NRI-US users only). Empty / omitted → flat FX rate. */
  fx_drift_annualized?: Record<string, string>;
}

// ─── response types ─────────────────────────────────────────────────────────

export interface TrajectoryPointRaw {
  month: number;
  balance: string;
  interest_paid: string;
  invested: string;
  /** Per-loan total payment this month, keyed by 0-based index into
   *  `user.loans`. Empty after every loan clears. */
  payments_by_loan_index?: Record<string, string>;
  /** Total outstanding balance, broken out by loan currency (INR / USD).
   *  Single-currency users see a 1-element dict matching `balance`. Hybrid
   *  users see one entry per currency so the trajectory chart can draw
   *  separate lines instead of summing dissimilar units. */
  balances_by_currency?: Record<string, string>;
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

export type AssetType =
  | 'savings_balance' | 'fixed_deposit'
  | 'equity_stocks' | 'equity_mf' | 'debt_mf'
  | 'gold_physical' | 'sgb'
  | 'real_estate' | 'ppf' | 'epf' | 'nps'
  | 'other';

export interface AssetPayload {
  asset_type: AssetType | string;
  purchase_price: string;
  purchase_date: string;                // YYYY, YYYY-MM, or YYYY-MM-DD
  current_market_value: string;
  rental_income_annual?: string;
  holding_costs_annual?: string;
  state?: string;
  /** User-facing label, e.g. "HDFC FD #2", "Bangalore flat". */
  label?: string;
  /** Optional override for the asset class's default expected return. */
  expected_return_pct?: string;
  /** User's self-assessment — "could I sell this within 30 days?". */
  user_marks_liquid?: boolean;
  // FD-specific
  fd_rate_pct?: string;
  fd_maturity_date?: string;
  fd_premature_penalty_pct?: string;
  // PPF-specific
  ppf_opened_date?: string;
  // SGB-specific
  sgb_at_maturity?: boolean;
  // US-specific — IRC §121 primary-residence exclusion eligibility
  us_section_121_eligible?: boolean;
  // US-specific — set for muni-bond mutual funds whose coupon interest is
  // federally tax-exempt under §103. Recasts expected return to taxable-
  // equivalent yield when ranking hold-vs-sell against debt cost.
  us_is_tax_exempt_muni?: boolean;
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

// ─── Portfolio liquidation advisor ──────────────────────────────────────────

export interface ProceedsResult {
  asset_label: string;
  asset_type: string;
  gross_proceeds: string;
  tax_owed: string;
  penalty: string;
  transaction_costs: string;
  net_proceeds: string;
  explanation: string;
  is_blocked: boolean;
  block_reason: string;
  caveats: string[];
}

export type LiquidationVerdict =
  | 'clear_win' | 'conditional' | 'marginal' | 'dont_sell';

export interface LiquidationRecommendation {
  asset_index: number;
  asset_label: string;
  asset_type: string;
  target_loan_index: number;
  target_loan_label: string;
  proceeds: ProceedsResult;
  debt_balance: string;
  debt_effective_rate: string;
  debt_cleared_amount: string;
  interest_saved_yr1_nominal: string;
  asset_return_pct: string;
  holding_cost_given_up_yr1: string;
  net_annual_benefit_nominal: string;
  net_annual_benefit_real: string;
  verdict: LiquidationVerdict;
  /** Only populated for entries in the considered_but_skipped bucket. */
  skip_reason: string | null;
}

export interface LiquidationRankingsResponse {
  recommendations: LiquidationRecommendation[];
  considered_but_skipped: LiquidationRecommendation[];
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
  /** Overall-cheapest alternative when the recommended target is biased
   *  toward an existing-relationship bank. UI surfaces this as a dismissable
   *  "also worth knowing" hint, not the headline. */
  alternative_target_bank?: string | null;
  alternative_target_rate?: string | null;
  alternative_annual_saving?: string | null;
  /** True iff target_bank was chosen because the user already deals with it
   *  (primary_bank, other_banks, or an existing loan). UI uses this to add a
   *  "you already use this bank" badge. */
  target_is_existing_relationship?: boolean;
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
    credentials: 'include',
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`${path} → ${res.status}: ${detail}`);
  }
  // 204 No Content has an empty body — return undefined cast to T.
  if (res.status === 204) return undefined as unknown as T;
  return res.json() as Promise<T>;
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    cache: 'no-store',
    credentials: 'include',
  });
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

async function putJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
    credentials: 'include',
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`${path} → ${res.status}: ${detail}`);
  }
  if (res.status === 204) return undefined as unknown as T;
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
    /** Calendar month (1-12) corresponding to sim month 1. Anchors hike
     *  firing to the user's actual today. Defaults to 1 (Jan) server-side. */
    simulation_start_month?: number;
    /** Auto-reinvest events — month-indexed lump-sum injections in user
     *  residence currency, routed to the highest-effective-APR active loan
     *  at the matching month. Frontend pre-computes from projected annual
     *  tax savings when the "Auto-reinvest tax savings" toggle is on.
     *  Omit / empty array preserves baseline simulation behaviour. */
    reinvest_events?: { month: number; amount: string }[];
    /** When true, engine inflates fixed + variable expenses each month
     *  using user.inflation_rate. Drives the /plan inflation toggle. */
    inflate_expenses?: boolean;
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
    /** 1-based month from which `surplus_delta` applies (default 1 = now). */
    surplus_delta_start_month?: number;
    income_shock_months?: number;
    rate_shock_delta?: string;
    rate_shock_floating_only?: boolean;
    alt_strategy?: Strategy;
    lump_sum_amount?: string;
    lump_sum_target_loan_index?: number;
    /** Calendar month (1-12) corresponding to sim month 1. */
    simulation_start_month?: number;
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

  liquidationRankings: (req: {
    user: UserPayload;
    /** Map of loan index → effective APR (decimal string, e.g. "0.42"). Use
     *  the same effectiveAPR helper the rest of the app uses so the ranker
     *  scores debts at the rate the user already sees. */
    debt_effective_rates: Record<number, string>;
    marginal_rate?: string;
    high_rate_threshold?: string;
    horizon_years?: string;
    surplus_reinvestment_yield?: string;
    pre_filter_margin?: string;
  }) => post<LiquidationRankingsResponse>(
    '/api/portfolio/liquidation-rankings', req,
  ),

  institutions: (country?: Country) =>
    get<InstitutionPayload[]>(
      `/api/institutions${country ? `?country=${country}` : ''}`,
    ),

  // ─── auth ─────────────────────────────────────────────────────────────────
  requestOtp: (email: string) =>
    post<void>('/api/auth/request-otp', { email }),
  verifyOtp: (email: string, code: string) =>
    post<AuthUser>('/api/auth/verify-otp', { email, code }),
  logout: () => post<void>('/api/auth/logout', {}),
  me: () => get<AuthUser>('/api/auth/me'),

  // ─── per-user state (server-persisted JSON blob) ──────────────────────────
  getUserState: () => get<UserStatePayload>('/api/user/state'),
  putUserState: (data: Record<string, unknown>) =>
    putJson<UserStatePayload>('/api/user/state', { data }),
};

export interface AuthUser {
  id: string;
  email: string;
  display_name?: string | null;
}

export interface UserStatePayload {
  data: Record<string, unknown> | null;
  updated_at: string | null;
}

export interface RateRangePayload {
  low: string;
  high: string;
  median: string;
}

export interface InstitutionPayload {
  institution_id: string;
  country: Country;
  name: string;
  scrape_tier: string;
  home_loan: RateRangePayload | null;
  personal_loan: RateRangePayload | null;
  auto_loan: RateRangePayload | null;
  education_loan: RateRangePayload | null;
  credit_card_apr_low: string | null;
  credit_card_apr_high: string | null;
  processing_fee_pct: string | null;
  last_verified: string;
}

// ─── formatting helpers ─────────────────────────────────────────────────────

/** Indian lakh grouping: last 3 digits, then groups of 2. "1234567" → "12,34,567". */
function indianGroup(intStr: string): string {
  const neg = intStr.startsWith('-');
  const body = neg ? intStr.slice(1) : intStr;
  if (body.length <= 3) return (neg ? '-' : '') + body;
  const last3 = body.slice(-3);
  const rest = body.slice(0, -3);
  const grouped = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return (neg ? '-' : '') + grouped + ',' + last3;
}

/** Western grouping: groups of 3. "1234567" → "1,234,567". */
function westernGroup(intStr: string): string {
  const neg = intStr.startsWith('-');
  const body = neg ? intStr.slice(1) : intStr;
  return (neg ? '-' : '') + body.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** Rupees with lakh comma format. ₹1,23,45,678 — exact, no abbreviation. */
export function formatINR(value: string | number | Decimal): string {
  const d = new Decimal(value);
  return `₹${indianGroup(d.toFixed(0))}`;
}

/** Dollars with Western comma format. $1,234,567.89 — exact, no abbreviation. */
export function formatUSD(value: string | number | Decimal): string {
  const d = new Decimal(value);
  const [intPart, decPart] = d.toFixed(2).split('.');
  return `$${westernGroup(intPart)}.${decPart}`;
}

/** Compact INR for chart axes / tight stat tiles. Uses Cr/L/k abbreviation. */
export function formatINRCompact(value: string | number | Decimal): string {
  const d = new Decimal(value);
  const abs = d.abs();
  if (abs.gte(10_000_000)) return `₹${d.div(10_000_000).toFixed(2)}Cr`;
  if (abs.gte(100_000)) return `₹${d.div(100_000).toFixed(2)}L`;
  if (abs.gte(1_000)) return `₹${d.div(1_000).toFixed(1)}k`;
  return `₹${d.toFixed(0)}`;
}

/** Compact USD for chart axes / tight stat tiles. Uses M/k abbreviation. */
export function formatUSDCompact(value: string | number | Decimal): string {
  const d = new Decimal(value);
  const abs = d.abs();
  if (abs.gte(1_000_000)) return `$${d.div(1_000_000).toFixed(2)}M`;
  if (abs.gte(1_000)) return `$${d.div(1_000).toFixed(1)}k`;
  return `$${d.toFixed(2)}`;
}

export function formatCurrency(value: string | number | Decimal, currency: string): string {
  return currency.toUpperCase() === 'USD' ? formatUSD(value) : formatINR(value);
}

export function formatCurrencyCompact(value: string | number | Decimal, currency: string): string {
  return currency.toUpperCase() === 'USD' ? formatUSDCompact(value) : formatINRCompact(value);
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
