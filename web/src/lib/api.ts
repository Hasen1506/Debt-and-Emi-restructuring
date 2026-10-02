/**
 * Typed client for the FastAPI gateway. Decimals come over as strings;
 * call sites convert with decimal.js when arithmetic is needed and with
 * `formatINR` / `formatUSD` for display.
 */
import Decimal from 'decimal.js';
import { dec } from './safe-decimal';

const BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:8000';

// Auth cookies must belong to the web host so middleware can see them.
// Only authenticated state uses this fixed, same-origin proxy; engine calls
// keep using the configured API host (including server component calls).
function endpoint(path: string): string {
  if (typeof window !== 'undefined' && (path.startsWith('/api/auth/') || path === '/api/user/state')) {
    return `/api/session/${path.slice('/api/'.length)}`;
  }
  return `${BASE}${path}`;
}

// ─── shared types ───────────────────────────────────────────────────────────

// Public calculations do not use account cookies. Wildcard CORS responses
// cannot be read by credentialed browser requests.
function requestCredentials(path: string): RequestCredentials {
  return path.startsWith('/api/auth/') || path === '/api/user/state' ? 'include' : 'omit';
}

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
  /** Stable id, set when the loan is first saved (lib/loan-ids). Activity
   *  entries name their loan by it, so removing another loan can't move
   *  their payments. The API ignores it. */
  id?: string;
  /** Display metadata for an upcoming lifecycle loan; never persisted to the profile. */
  planned_effective_month?: number;
  /** 'YYYY-MM-DD' the balance was last entered (Setup, Profile, a new
   *  loan). The plan rolls an EMI loan's balance forward by the EMIs due
   *  since (lib/roll-forward). The API ignores it. */
  balance_as_of?: string;
  /** When the reported balance was saved. Separates payments earlier and later that day. */
  balance_recorded_at?: string;
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
  /** Credit cards only: day-of-month the statement is generated (1-28).
   *  Used for UX labels in the activity log ("Apr 5 statement, due Apr 25")
   *  and to default the payment date when logging. The engine doesn't
   *  consume this — interest math stays monthly-accrual. Omitting it
   *  keeps the old "this month" generic framing. */
  statement_day?: number;
  /** Credit cards only: day-of-month the bill is due (1-28). Onboarding
   *  pre-fills via suggestedGraceDays(bank) but the user can override —
   *  banks differ by 18-26 days, and individual cards within a bank can
   *  too. Like statement_day, UI-only — engine doesn't consume. */
  due_day?: number;
  /** Floating-rate loans only: bank's reset frequency in months. RLLR /
   *  EBLR (most post-2019 IN loans, all US ARMs after intro period) reset
   *  every 1 month; older MCLR loans typically 6 or 12 months. Drives
   *  the auto-reset cadence inside the simulator. */
  rate_reset_frequency_months?: number;
  /** Floating-rate loans only: calendar date of the next reset
   *  (YYYY-MM-DD). Frontend translates to sim-month before sending. */
  next_reset_date?: string;
  /** Engine-facing 1-based simulation month for the next reset. Derived
   *  on the request path from next_reset_date; not authored by the user. */
  next_reset_month?: number;
  /** Floating-rate loans only: projected annualised drift in the
   *  benchmark rate (e.g. '0.005' = +50bps/yr if you expect RBI hikes;
   *  '-0.005' if you expect cuts). Applied at each reset proportional
   *  to the reset frequency. */
  rate_drift_annualized?: string;
  /** True-APR restructuring triggers — see engine/models.py:Loan for
   *  semantics. All optional; defaults model the "no penalties / no
   *  restrictions / immediate-EMI" case.
   *  • prepayment_penalty_pct  — '0.02' = 2% of the prepay amount fee
   *  • prepay_lock_in_months   — months from disbursal before prepay allowed
   *  • part_payment_freq_months — minimum gap between extra payments
   *  • pre_emi_months_remaining — interest-only window before EMI starts */
  prepayment_penalty_pct?: string;
  prepay_lock_in_months?: number;
  part_payment_freq_months?: number;
  pre_emi_months_remaining?: number;
  /** How the lender quoted the rate. "reducing" (bank loans, default)
   *  treats `nominal_rate` as the APR. "flat" (consumer-durable / NBFC
   *  loans) gets converted to its reducing-balance equivalent at the
   *  engine boundary so the math stays apples-to-apples with bank quotes. */
  rate_basis?: 'flat' | 'reducing';
  /** Last 6 digits of the credit-card number (optional). Stored as a
   *  string ('XXXXXX'). UI-only — engine doesn't consume it. Used to
   *  render a recognisable card chip on /portfolio and Holdings. */
  card_last_6?: string;
  /** Cardholder name as printed on the card. Surfaces in the chip
   *  visualisation so the user can disambiguate two cards with the same
   *  bank (e.g. "Joint card" vs personal). */
  cardholder_name?: string;
}

export interface InvestmentOptionPayload {
  name: string;
  expected_return: string;
  liquidity_class: LiquidityClass;
  is_in_pool?: boolean;
}

/** A single cash account — checking, savings, HYSA, FD, or other. The
 *  cash module captures this as a list so the advisor can compare each
 *  account's post-tax APY against debt APR independently (e.g. Chase
 *  checking at 0.01% vs Ally HYSA at 4.5%). The engine doesn't consume
 *  these yet; for Phase 1 they're pure data capture + display, with
 *  `savings_balance` derived as the sum for backward compatibility. */
export type CashAccountKind = 'checking' | 'savings' | 'hysa' | 'fd' | 'other';

export interface CashAccountPayload {
  /** User-facing label, e.g. "Chase Checking" or "Ally HYSA". */
  name: string;
  /** Current balance, decimal string. */
  balance: string;
  /** Annual percentage yield as a decimal, e.g. "0.045" for 4.5%. Defaults
   *  to "0" if user doesn't know. Pre-tax — the advisor computes post-tax
   *  yield using the user's marginal rate when it runs. */
  apy: string;
  /** Kind drives whether the balance is "operational float" (checking,
   *  ~1 month expenses, excluded from optimizable pool) or "optimizable"
   *  (savings/HYSA/FD, above floor → eligible for debt-paydown advisor).
   *  FD has additional locked semantics that Phase 3 will model. */
  kind: CashAccountKind;
  /** Currency the account is denominated in. Defaults to user's residence
   *  currency. Only set explicitly for cross-currency cases (NRI-US user
   *  with INR savings). */
  currency?: 'INR' | 'USD';
}

/** Coarse age band — used for downstream nudges (retirement check at 50+,
 *  emergency-fund-first at <25). Never use exact age; the band is enough. */
/** '50_plus' is 50–59 (it was "50+" before 60+ had its own bracket). */
export type AgeBracket = 'under_25' | '25_35' | '35_50' | '50_plus' | '60_plus';

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
  /** Optional per-account breakdown of liquid cash. When non-empty, the
   *  rich `cash_accounts` array is the source of truth and `savings_balance`
   *  is the legacy total (sum of optimizable balances, kept in sync at
   *  save time for back-compat with older callers / the engine's surplus
   *  model). When empty/omitted, `savings_balance` alone is used.
   *  Captured at onboarding step 4, displayed on /debts. */
  cash_accounts?: CashAccountPayload[];
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
  /** Annual tax (₹/$) on income that's NOT covered by employer TDS —
   *  rental, FD interest > ₹40k, capital gains, freelance side-income.
   *  Salaried users opt in by entering a number here; the tax sleeve
   *  card on /debts then targets this annual liability. Defaults to 0
   *  / undefined when user has no extra income. Business owners ignore
   *  this — their sleeve target is derived from annual_business_income. */
  extra_income_annual_tax?: string;
  /** Multi-stream income model — captures sources beyond a single
   *  primary income, and historical transitions (salaried → freelance,
   *  added a side gig, retired from one role). When non-empty, the
   *  monthly_income field is derived as sum of *active* streams / 12 at
   *  save time, and the tax sleeve consumes active streams instead of a
   *  single annual_business_income / extra_income_annual_tax input.
   *
   *  Empty / omitted → legacy single-source behaviour. Engine drops the
   *  field — it consumes the derived monthly_income + marginal_rate. */
  income_streams?: IncomeStreamPayload[];
  /** Old-regime / itemized deductions. Captured at onboarding step 2
   *  conditionally — IN only renders these when tax_regime === 'old';
   *  US renders the itemized block unconditionally (state tax + mortgage
   *  interest are universally relevant). All fields are annual rupees /
   *  dollars as strings, optional everywhere. Drives a more accurate
   *  derived marginal_rate when gross income is on file. */
  deductions?: DeductionsPayload;
}

export type IncomeStreamKind =
  | 'salaried'
  | 'business_owner'
  | 'freelance'
  | 'rental'
  | 'capital_gains'
  | 'other';

/**
 * How the stream gets taxed — drives slab vs flat-tax routing in the
 * marginal-rate computation. Defaulted from `kind` at the UI layer; the
 * user can override (e.g. a freelancer whose actual expenses exceed 50%
 * of gross will pick business_normal over the presumptive default).
 *
 *  • salary           — slab; TDS by employer; standard deduction applies
 *                       (₹50k IN / per-filing-status US)
 *  • business_44ada   — presumptive professionals: 50% of gross deemed
 *                       profit; remaining gross excluded from slab pool.
 *                       Requires gross < ₹50L (IN services).
 *  • business_normal  — full P&L: stream contributes gross to slab pool,
 *                       allowable_expenses subtract back out at compute.
 *  • rental           — house property: gross × 0.7 contributes to slab
 *                       (30% standard deduction), home-loan interest
 *                       deductible separately at the loan record.
 *  • capital_gains    — bypasses slab; LTCG taxed at 20% (with indexation)
 *                       or 10% above ₹1L exempt threshold (equity STT).
 *                       Stream's tax computed at flat rate, added to total
 *                       liability after slab math runs.
 */
export type IncomeStreamTaxTreatment =
  | 'salary'
  | 'business_44ada'
  | 'business_normal'
  | 'rental'
  | 'capital_gains';

/**
 * One income stream. Multiple streams capture concurrent sources
 * (salary + side consulting) or transitions over time (salaried from
 * Jan-Jun, freelance from Jul onwards — end the salaried entry and
 * start the freelance one).
 */
export interface IncomeStreamPayload {
  /** Client-generated stable id, used for React keys and ledger linking. */
  id: string;
  kind: IncomeStreamKind;
  /** User-facing label — "Acme Co salary", "Consulting", "Rental — Pune flat". */
  label: string;
  /** Annual gross from this stream, as string for decimal precision. */
  gross_annual: string;
  /** When the stream started — YYYY-MM-DD or YYYY-MM (month-only OK). */
  start_date: string;
  /** When the stream ended. Omitted / blank = currently active. */
  end_date?: string;
  /** TDS / withholding rate as decimal — 0.3 means 30% already withheld at
   *  source (typical for salaried). 0 means you owe the tax yourself
   *  (business income, freelance under 194J, capital gains). Used by the
   *  tax sleeve to know how much liability falls on the user vs the payer. */
  tds_pct?: string;
  /** Tax-treatment routing for the bracket computation. Defaulted from
   *  `kind` at the UI layer; users with non-typical situations (a
   *  freelancer claiming actual expenses, a salary stream with allowances)
   *  override it explicitly. When omitted, callers must apply
   *  `defaultTaxTreatment(kind)`. See [[IncomeStreamTaxTreatment]] for the
   *  routing rules. */
  tax_treatment?: IncomeStreamTaxTreatment;
}

/**
 * Tax deduction inputs. Indian fields (hra_*, sec_80*) only meaningful
 * for old-regime filers; US fields (state_marginal_rate_override,
 * mortgage_interest_annual, itemized_deductions_other) apply unconditionally
 * and feed an itemize-vs-standard helper.
 */
export interface DeductionsPayload {
  // India — old regime only
  /** Annual HRA claimed by user (already net of statutory cap). */
  hra_claim_annual?: string;
  /** Annual rent paid — UI shows this alongside HRA so the user can
   *  sanity-check that the claim doesn't exceed the rent. Not used in
   *  the math directly. */
  rent_paid_annual?: string;
  /** 80C: PPF + ELSS + life insurance + principal-of-home-loan etc.
   *  Capped at ₹1.5L at compute time. */
  sec_80c_annual?: string;
  /** 80D: health insurance premiums. Cap depends on family + parent
   *  ages; we apply the conservative ₹25k cap unless the user is 60+. */
  sec_80d_annual?: string;
  /** 80E: education loan interest. Fully deductible — no cap. */
  sec_80e_annual?: string;
  /** 80CCD(1B): NPS additional contribution (₹50k cap). */
  sec_80ccd1b_annual?: string;
  // US — applies regardless of state
  /** Override for the auto-detected state marginal rate. Defaults to
   *  user.state_marginal_rate (already on UserPayload) when omitted. */
  state_marginal_rate_override?: string;
  /** Annual mortgage interest paid — feeds itemize-vs-standard. */
  mortgage_interest_annual?: string;
  /** Other itemized deductions (SALT cap'd at $10k, charity, etc.) */
  itemized_deductions_other?: string;
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
  /** Per-loan outstanding this month, keyed by 0-based index in user.loans.
   *  Drives the per-loan trajectory chart on /plan. Cleared loans stay
   *  in the map with value "0" so the chart sees a stable series. */
  balances_by_loan_index?: Record<string, string>;
  /** Pre-allocation surplus the engine had to route this month. Lets
   *  client-side achievability sum the realised surplus (which already
   *  reflects inflation, hike, lifecycle events) instead of multiplying
   *  a single static number by a month count. */
  available_surplus?: string;
  /** Per-goal contribution this month, keyed by goal id. Empty when
   *  `goals` wasn't sent to /simulate. Lets achievability subtract
   *  prior-goal actual draws (which expire after their target dates)
   *  instead of a flat priorDraw approximation. */
  goal_contributions?: Record<string, string>;
  /** All payments this month, in the user's currency. */
  total_paid?: string;
  /** The part above each loan's minimum (extra, cascade), user's currency. */
  extra_paid?: string;
  /** Income short of costs plus minimums this month ('0' when covered). */
  shortfall?: string;
}

export interface GoalContributionRaw {
  /** Goal id mirroring the request's `goals[].id`. */
  goal_id: string;
  /** Amount routed to this goal in the first sim month. */
  amount: string;
  /** Run-rate (remaining / months_until) for this month. Lets the UI
   *  show "₹X needed / ₹Y allocated" when funded partially. */
  run_rate: string;
  /** null when funded; else 'past_date' | 'over_funded' |
   *  'surplus_exhausted' | 'partial_fill' | 'deferred'. Drives the
   *  queued-goals footer text. `deferred` is the user's explicit
   *  choice to delay funding until a later sim month — distinct
   *  from `surplus_exhausted` (which is involuntary). */
  queued_reason: string | null;
  /** Snapshot-only — 0-based sim-month at which deferred funding
   *  starts. null when not deferred. Lets the SurplusWaterfall on
   *  /plan render "Wedding · ₹0/mo (starts month 7)" instead of
   *  just "₹0/mo (deferred)" with no horizon. */
  funding_start_month_index?: number | null;
}

export interface SurplusAllocationRaw {
  /** First-month surplus the engine computed, decimal string. */
  surplus: string;
  /** Slice routed to the active preempting goal (zero unless ef_preempted). */
  goal_slice: string;
  /** Slice routed to the EF top-up (zero when EF target reached or ef_split=0). */
  ef_slice: string;
  /** Slice routed to highest-effective-APR debt (the remainder). */
  debt_slice: string;
  /** Whether a preempting goal forced 100%-to-goal routing. */
  ef_preempted: boolean;
  /** EF split fraction the engine applied (0..1). */
  ef_split: string;
  /** Per-goal slices for the first sim month — empty when no goals
   *  passed in the request. */
  goal_contributions?: GoalContributionRaw[];
  /** True when at least one active goal received less than its
   *  run-rate this month. Drives the "some goals are short" banner. */
  any_goal_short?: boolean;
}

export interface GoalFinalRaw {
  /** Mirrors the request goal id. */
  goal_id: string;
  /** Funded amount (= goal.amount × (1 + buffer_pct)). */
  required: string;
  /** Amount actually saved by the target month (or at end of horizon
   *  when the target is beyond the simulated window). */
  saved_at_target: string;
  /** saved_at_target / required, clamped to [0, 1]. Decimal string. */
  fill_rate: string;
  /** True when the target month was within the simulated horizon. When
   *  False, the fill_rate is based on end-of-horizon saved so far. */
  target_reached: boolean;
  /** True when the goal's target month is beyond the simulated horizon
   *  (typically because the sim broke out at debt_free_month). Lets the
   *  UI render an honest "deadline is past your debt-free month — fund
   *  manually after that" instead of a misleading "not reached" tone.
   *  Always False when target_reached is True. */
  target_past_horizon?: boolean;
  /** True when saved_at_target ≥ required. Distinct from target_reached:
   *  `funded=true, target_reached=false` means the sim ended before
   *  the goal's deadline but the user is already on track to hit it. */
  funded: boolean;
}

export interface SimulateResponse {
  debt_free_month: number | null;
  total_interest_paid: string;
  total_invested: string;
  trajectory: TrajectoryPointRaw[];
  months_in_horizon: number;
  /** This month's income short of costs plus minimum payments ('0' when
   *  covered); above 0, the plan's date assumes money the user doesn't have. */
  shortfall?: string;
  /** Engine-computed surplus allocation for the first sim month. The /plan
   *  SurplusWaterfall card reads this so the displayed pie matches what
   *  the engine actually applies (instead of a client-side mirror that
   *  could drift). Absent on /baseline (minimums-only doesn't route surplus). */
  surplus_allocation?: SurplusAllocationRaw | null;
  /** Per-goal end-of-trajectory fill rates. Drives the "expected X%
   *  by your target" badge on /goals + /plan. Empty when no goals
   *  were sent in the request. */
  goal_finals?: GoalFinalRaw[];
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
  verdict: 'take' | 'pay_cash' | 'delay' | 'cant_afford';
  detail: string;
}

export interface WindfallResponse {
  loan_label: string;
  /** Position in user.loans of the loan the money goes to; null when invested. */
  loan_index?: number | null;
  amount: string;
  rationale: string;
  /** Never negative. When investing wins, the interest given up. */
  interest_avoided: string;
  invest_instead: boolean;
  investment_name: string | null;
  investment_return: string | null;
  /** Windfall left after clearing the loan. */
  leftover: string;
  /** What interest_avoided assumes, e.g. "until the card is cleared,
   *  paying the bank's minimum each month". */
  interest_basis?: string;
  /** The loan's prepayment fee, taken out of `amount`. */
  fee?: string;
  /** interest_avoided less the fee. */
  net_benefit?: string;
  /** Loans passed over because their terms bar an extra payment now. */
  blocked?: string[];
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
  verdict: 'borrow_now' | 'wait' | 'cant_afford';
  estimated_savings: string;
  detail: string;
  /** The EMI at today's rate. */
  monthly_payment: string;
  /** Left each month after costs and payments, when a profile was sent. */
  monthly_room?: string | null;
  /** On the market's odds: the chance of a cut by `wait_until`. */
  cut_chance?: string | null;
  rise_chance?: string | null;
  /** The saving if the cut comes (estimated_savings is on the odds). */
  saving_if_cut?: string | null;
  wait_until?: string | null;
  rate_floats?: boolean;
  odds?: RateOddsResponse | null;
}

/** The market's chance of each move at the coming RBI or Fed decisions. */
export interface RateOddsResponse {
  country: 'IN' | 'US';
  source: string;
  fetched_at: string | null;
  meetings: {
    date: string;
    title: string;
    url: string;
    volume: string;
    cut_chance: string;
    rise_chance: string;
    outcomes: { bps: number; label: string; chance: string }[];
  }[];
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
  // Holdings tracker — when set, current_market_value is derived as
  // quantity × last_price and can be refreshed via /api/holdings/quote.
  // Only meaningful for equity_stocks and equity_mf entries.
  ticker?: string;
  quantity?: string;
  last_price?: string;
  last_price_at?: string;
  /** Currency of last_price when it isn't the profile's (a `.NS` stock in
   *  a US profile). current_market_value is then converted at fx_to_user:
   *  profile-currency units per 1 price-currency unit, dated fx_as_of. */
  price_currency?: string;
  fx_to_user?: string;
  fx_as_of?: string;
  /** Per-asset projected appreciation CAGR (decimal — e.g. "0.07" = 7%/yr).
   *  Optional; when omitted the country/asset-type default is used. Most
   *  meaningful for real-estate (regional CAGRs vary wildly) and gold. */
  appreciation_cagr?: string;
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
  /** The edge selling must reach to pass (10% of the asset). */
  wealth_edge_needed?: string | null;
  /** 'amortising': the loan is paid on schedule on both paths;
   *  'debt_compounds': no payment given, the debt grows unpaid. */
  wealth_basis?: 'amortising' | 'debt_compounds' | null;
  horizon_years: string | null;
  recommend_liquidation: boolean;
  rationale: string;
  /** How the tax was worked out (US: the rules, any §121 exclusion, what to
   *  check). Empty for India, whose rules the form itself describes. */
  tax_notes?: string[];
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
  source: 'frankfurter' | 'open-er-api' | 'parity' | 'manual' | 'fallback';
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
  /** Interest saved in the first 12 months, minus the one-time cost. The
   *  same measure for every kind. */
  estimated_annual_saving: string;
  /** Fee or switching cost paid up front. */
  one_time_cost?: string;
  /** Months of lower interest needed to earn back `one_time_cost`. */
  breakeven_months?: number | null;
  /** Refinance only: saving over the rest of the loan, after costs. */
  lifetime_net_saving?: string | null;
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
  /** ISO date of the rate-card entry the target_rate was sourced from.
   *  Populated when the target is a Tier-A bank with a verified card;
   *  null for Tier-B/C indicative entries or non-card-sourced rates. UI
   *  surfaces this as a "rate as of" tag on the opportunity row. */
  target_rate_as_of?: string | null;
  /** 0-based positions into user.loans this opportunity acts on. Drives
   *  the "I took this — update terms" modal: refi/BT use [0] to mutate
   *  one loan in place; consolidation lists every loan being merged so
   *  the modal can mark them cleared and append a new consolidated
   *  personal loan. */
  affected_loan_indices?: number[];
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

// ─── Loan Check ─────────────────────────────────────────────────────────────

export type LoanBenchmark = 'repo' | 'mclr' | 'base_rate' | 'unknown';

export interface LoanCheckRequest {
  lender?: string;
  loan_start: string;               // "YYYY-MM"
  start_rate?: string;              // fractions
  start_benchmark_rate?: string;
  start_spread?: string;
  current_rate: string;
  outstanding: string;
  tenure_months_remaining: number;
  emi?: string;
  benchmark: LoanBenchmark;
  last_reset?: string;              // "YYYY-MM"
}

export interface LoanCheckCitation {
  rule: string;
  requirement: string;
  source: string;
  verified_against_text: boolean;
}

export interface LoanCheckFinding {
  kind: 'missed_rate_cut' | 'pricing_gap' | 'old_benchmark';
  headline: string;
  detail: string;
  claimable: boolean;
  rate_gap: string;
  amount_this_year: string;
  overcharged_so_far: string;
  months_overcharged: number;
  citations: LoanCheckCitation[];
  next_step: string;
}

export interface LoanCheckResponse {
  status: 'issues_found' | 'no_issue' | 'not_applicable';
  summary: string;
  findings: LoanCheckFinding[];
  start_rate: string;
  expected_rate: string | null;
  current_rate: string;
  repo_at_start: string | null;
  repo_reference_now: string | null;
  repo_today: string;
  repo_changes_since_start: { date: string; old_rate: string; new_rate: string }[];
  claim_amount: string;
  amount_at_stake_this_year: string;
  assumptions: string[];
  rates_as_of: string;
  rates_source: string;
  stale_rates_warning: string | null;
}

export type ComplaintReply = 'none' | 'fixed' | 'partly' | 'rejected';

/** Loan facts plus where the complaint has got to. No personal details:
 *  letters come back with placeholders the browser fills in. */
export interface ComplaintRequest extends LoanCheckRequest {
  sent_on?: string;                 // "YYYY-MM-DD"
  received_on?: string;
  reply?: ComplaintReply;
  reply_on?: string;
  io_reviewed?: boolean;
  bank_reference?: string;
}

export interface ComplaintLetter {
  kind: 'grievance' | 'io_followup';
  subject: string;
  claim_amount: string;
  citations: LoanCheckCitation[];
  annexure: { month: string; should_be: string; charged: string; excess: string }[];
  annexure_total: string;
  /** The whole letter as plain text, placeholders included. */
  text: string;
}

export interface ComplaintMilestone {
  key: string;
  label: string;
  day: string;                      // "YYYY-MM-DD"
  state: 'done' | 'due' | 'overdue' | 'upcoming' | 'missed';
  note: string;
}

export interface ComplaintTimeline {
  stage:
    | 'awaiting_reply'
    | 'internal_ombudsman'
    | 'ombudsman_open'
    | 'window_closed'
    | 'fixed';
  milestones: ComplaintMilestone[];
  next_action: string;
  days_left: number | null;
  escalation_opens: string | null;
  escalation_deadline: string | null;
  notes: string[];
}

export interface OmbudsmanComplaint {
  fields: { label: string; value: string; hint: string }[];
  facts: string;
  relief: string;
  declarations: string[];
  documents: string[];
  opens: string | null;
  deadline: string | null;
  how_to_file: string[];
  citations: LoanCheckCitation[];
  claim_amount: string;
}

export interface ComplaintPlaceholders {
  name: string;
  account: string;
  phone: string;
  email: string;
  address: string;
  bank_reference: string;
  bank_name: string;
  optional_lines: string[];
}

export interface ComplaintResponse {
  letter: ComplaintLetter;
  timeline: ComplaintTimeline | null;
  io_followup: ComplaintLetter | null;
  ombudsman: OmbudsmanComplaint | null;
  placeholders: ComplaintPlaceholders;
}

// ─── Offer comparison (the lender's reply) ─────────────────────────────────

export interface ResetOfferIn {
  rate: string;                     // fraction
  fee?: string;                     // amount, or…
  fee_percent?: string;             // …a fraction of the outstanding
  fee_plus_gst?: boolean;
}

export interface RefinanceOfferIn {
  rate: string;
  lender?: string;
  processing_fee?: string;
  processing_fee_percent?: string;
  fee_plus_gst?: boolean;
  stamp_duty?: string;
  legal_and_valuation?: string;
  prepayment_charge?: string;
  months?: number;
}

export type OfferMode = 'lower_emi' | 'same_emi';

export interface OfferCompareRequest extends LoanCheckRequest {
  reset?: ResetOfferIn;
  refinance?: RefinanceOfferIn;
  mode?: OfferMode;
  horizon_months?: number;
}

export interface OfferOption {
  key: 'keep' | 'keep_owed' | 'reset' | 'refinance';
  label: string;
  rate: string;
  emi: string;
  months: number;
  last_payment: string;
  upfront: { label: string; amount: string }[];
  upfront_total: string;
  interest_total: string;
  cost_to_horizon: string;
  saving: string;
  break_even_month: number | null;
  break_even_on: string | null;
}

export interface OfferCompareResponse {
  options: OfferOption[];
  baseline: 'keep' | 'keep_owed';
  horizon_months: number;
  verdict: 'keep' | 'reset' | 'refinance';
  headline: string;
  reason: string;
  next_step: string;
  warnings: string[];
  notes: string[];
  citations: LoanCheckCitation[];
  entitled_rate: string | null;
}

// ─── shared lender outcomes (Phase 4) ──────────────────────────────────────

export type OutcomeKind = 'fixed_full' | 'fixed_part' | 'refused' | 'no_reply';

/** Only these facts are ever shared: no name, account, amount or date. */
export interface OutcomeReportRequest {
  lender: string;
  outcome: OutcomeKind;
  days_taken: number;
  rate_before: string;
  rate_after?: string;
}

export interface OutcomeReportResponse {
  lender: string;
  reports_for_lender: number;
  min_reports: number;
  message: string;
}

export interface LenderScore {
  known: boolean;
  lender_id: string | null;
  lender: string | null;
  reports: number;
  min_reports: number;
  shown: boolean;
  hidden_reason: string | null;
  headline: string | null;
  fixed_in_full_pct: string | null;
  fixed_any_pct: string | null;
  median_days: string | null;
  median_rate_cut: string | null;
  counts: Partial<Record<OutcomeKind, number>>;
  verified_reports: number;
  label: string;
  label_detail: string;
}

/** A 422 from an endpoint that answers `{detail: {field, message}}`. */
export class ApiFieldError extends Error {
  constructor(public field: string, message: string) {
    super(message);
  }
}

/**
 * Calls made by the Next.js server (the /plan render calls the API for
 * every user) identify themselves so the API does not rate-limit them
 * together. INTERNAL_API_TOKEN is not a NEXT_PUBLIC_ variable, so it is
 * never built into the browser bundle; in the browser this is empty.
 */
function serverHeaders(): Record<string, string> {
  const token = typeof window === 'undefined' ? process.env.INTERNAL_API_TOKEN : undefined;
  return token ? { 'X-Internal-Token': token } : {};
}

async function postWithFieldErrors<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(endpoint(path), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...serverHeaders() },
    body: JSON.stringify(body),
    cache: 'no-store',
    credentials: requestCredentials(path),
  });
  if (res.status === 422) {
    const data = await res.json().catch(() => null);
    const d = data?.detail;
    if (d && typeof d === 'object' && !Array.isArray(d) && typeof d.message === 'string') {
      throw new ApiFieldError(String(d.field ?? ''), d.message);
    }
    throw new ApiFieldError('', 'Some of the details could not be read. Check the numbers and try again.');
  }
  if (res.status === 429) {
    const data = await res.json().catch(() => null);
    const m = data?.detail?.message;
    throw new Error(
      typeof m === 'string' ? m : 'Too many checks from this connection. Wait a minute and try again.',
    );
  }
  if (res.status === 413) {
    throw new Error('That is more than the app can check at once. Remove some entries and try again.');
  }
  if (!res.ok) {
    throw new Error(`The server could not run the check (${res.status}). Try again in a minute.`);
  }
  return res.json() as Promise<T>;
}

// ─── thin fetch helper ──────────────────────────────────────────────────────

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(endpoint(path), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...serverHeaders() },
    body: JSON.stringify(body),
    cache: 'no-store',
    credentials: requestCredentials(path),
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`${path} → ${res.status}: ${detail}`);
  }
  // 204 No Content has an empty body — return undefined cast to T.
  if (res.status === 204) return undefined as unknown as T;
  return res.json() as Promise<T>;
}

function accountHeaders(path: string): Record<string, string> {
  if (path === '/api/user/state' && typeof window !== 'undefined') {
    try {
      const account = localStorage.getItem('finoptima_account_id');
      if (account) return { 'X-Account-Id': account };
    } catch { /* Browser storage may be unavailable. */ }
  }
  return {};
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(endpoint(path), {
    headers: { ...serverHeaders(), ...accountHeaders(path) },
    cache: 'no-store',
    credentials: requestCredentials(path),
  });
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

async function putJson<T>(path: string, body: unknown, method: 'PUT' | 'PATCH' = 'PUT'): Promise<T> {
  const res = await fetch(endpoint(path), {
    method,
    headers: { 'Content-Type': 'application/json', ...serverHeaders(), ...accountHeaders(path) },
    body: JSON.stringify(body),
    cache: 'no-store',
    credentials: requestCredentials(path),
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

  simulate: (req: SimulateArgs) => post<SimulateResponse>('/api/simulate', req),

  baseline: (req: {
    user: UserPayload;
    horizon_months?: number;
    simple_mode?: boolean;
    /** Same planned rate resets as the plan, so "saved vs minimums"
     *  compares like with like. */
    lifecycle_events?: LifecycleEventInput[];
  }) => post<SimulateResponse>('/api/baseline', req),

  /** Both runs take the plan's own settings (PlanRunArgs), so the
   *  what-if's "before" is the plan /plan shows. */
  sensitivity: (req: Partial<PlanRunArgs> & {
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
    country?: 'IN' | 'US';
    /** Income − costs − payments already owed, per month (negative when short). */
    monthly_room?: string;
  }) => postWithFieldErrors<NewDebtResponse>('/api/new-debt', req),

  windfall: (req: {
    amount: string;
    user: UserPayload;
    marginal_rate?: string;
    strategy?: Strategy;
  }) => postWithFieldErrors<WindfallResponse>('/api/windfall', req),

  quickRecompute: (req: {
    user: UserPayload;
    extra_payment: string;
    target_loan_index?: number;
    strategy?: Strategy;
    horizon_months?: number;
    marginal_rate?: string;
  }) => postWithFieldErrors<QuickRecomputeResponse>('/api/quick-recompute', req),

  cashYield: (req: {
    idle_balance: string;
    current_yield: string;
    country: Country;
    top_loan_effective_rate?: string;
    best_alt_yield?: string;
    alt_name?: string;
    minimum_idle_threshold?: string;
  }) => postWithFieldErrors<CashYieldResponse>('/api/cash-yield', req),

  /** Without consensus_change_bps the verdict goes on the market's odds. */
  rightTime: (req: {
    current_rate: string;
    six_month_avg?: string;
    consensus_change_bps?: number;
    months_to_decision?: number;
    urgency: 'now' | '3m_ok' | '6m_ok';
    principal: string;
    tenure_months: number;
    rate_type?: 'fixed' | 'floating';
    country?: Country;
    /** Income − costs − current payments, from the profile. */
    monthly_room?: string;
  }) => postWithFieldErrors<BorrowTimingResponse>('/api/right-time-to-borrow', req),

  loanCheck: (req: LoanCheckRequest) =>
    postWithFieldErrors<LoanCheckResponse>('/api/loan-check', req),

  complaintIn: (req: ComplaintRequest) =>
    postWithFieldErrors<ComplaintResponse>('/api/complaints/in', req),

  compareOffers: (req: OfferCompareRequest) =>
    postWithFieldErrors<OfferCompareResponse>('/api/offers/compare', req),

  shareOutcome: (req: OutcomeReportRequest) =>
    postWithFieldErrors<OutcomeReportResponse>('/api/outcomes', req),

  lenderScore: (name: string) =>
    get<LenderScore>(`/api/outcomes/scorecard/lender?name=${encodeURIComponent(name)}`),

  outcomeLenders: () => get<{ id: string; name: string }[]>('/api/outcomes/lenders'),

  scoreImpact: (req: {
    action: ScoreAction;
    current_score: number;
    country?: string;
    utilisation_from?: string;
    utilisation_to?: string;
    is_only_instalment_loan?: boolean;
    has_thin_file?: boolean;
  }) => postWithFieldErrors<ScoreImpactResponse>('/api/score-impact', req),

  rateOffered: (req: {
    advertised_rate: string;
    score: number;
    loan_type: string;
    country?: string;
  }) => postWithFieldErrors<RateOfferedResponse>('/api/rate-offered', req),

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
  }) => postWithFieldErrors<CrossBorderResponse>('/api/cross-border-decision', req),

  restructuring: (req: {
    user: UserPayload;
    marginal_rate?: string;
  }) => post<RestructuringResponse>('/api/restructuring', req),

  assetLiquidation: (req: {
    asset: AssetPayload;
    sale_price: string;
    debt_balance: string;
    debt_effective_rate: string;
    /** The loan's monthly payment; without it the hold path is a stress
     *  case where the debt goes unpaid. */
    debt_monthly_payment?: string;
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
    /** Slab rate incl. cess; used when the property was held ≤ 24 months. */
    marginal_rate?: string;
    /** Whose tax rules apply: US uses federal capital-gains tax, NIIT, the
     *  state rate and the §121 exclusion instead of India's LTCG. */
    country?: Country;
    filing_status?: FilingStatusUS;
    state_marginal_rate?: string;
  }) => postWithFieldErrors<AssetLiquidationResponse>('/api/asset-liquidation', req),

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
  }) => postWithFieldErrors<LiquidationRankingsResponse>('/api/portfolio/liquidation-rankings', req,
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
  patchUserState: (data: Record<string, unknown>) =>
    putJson<UserStatePayload>('/api/user/state', { data }, 'PATCH'),

  marketLowest: (country: 'IN' | 'US', loanType: string) =>
    get<{ country: string; loan_type: string; bank: string | null; low: string | null }>(
      `/api/market-lowest?country=${country}&loan_type=${loanType}`,
    ),

  loanTerms: (
    country: 'IN' | 'US',
    loanType: string,
    bank: string = '',
    rateType: 'floating' | 'fixed' = 'floating',
  ) =>
    get<LoanTermsResponse>(
      `/api/loan-terms?country=${country}&loan_type=${loanType}` +
        `&bank=${encodeURIComponent(bank)}&rate_type=${rateType}`,
    ),

  centralRates: () =>
    get<CentralRatesResponse>('/api/rates/central'),

  rateOdds: (country: Country) =>
    get<RateOddsResponse>(`/api/rates/odds?country=${country}`),
};

export interface LoanTermsResponse {
  country: 'IN' | 'US';
  loan_type: string;
  bank: string | null;
  rate_type: string;
  prepayment_penalty_pct: string | null;
  prepay_lock_in_months: number | null;
  part_payment_freq_months: number | null;
  /** False = regulatory mandate (trust the value); true = typical
   *  industry norm (user should confirm against their sanction letter). */
  is_indicative: boolean;
  /** Provenance string — either a regulatory citation (e.g. "RBI master
   *  direction...") or an honest "industry norms" tag with the date. */
  last_verified: string;
}

export interface CentralBankMeeting {
  date: string;
  outcome_rate: string | null;
  note: string;
}
export interface CentralBankCountryRate {
  country: 'IN' | 'US';
  current_rate: string;
  updated_at: string;   // the decision that set current_rate
  as_of: string;        // last day the rate was known to be current
  source: string;
  upcoming_meetings: CentralBankMeeting[];
  next_meeting_date: string | null;
  days_until_next: number | null;
}
export interface CentralRatesResponse {
  last_updated: string;
  IN: CentralBankCountryRate;
  US: CentralBankCountryRate;
}

export interface AuthUser {
  id: string;
  email: string;
  display_name?: string | null;
}

export interface LifecycleEventInput {
  kind: 'salary_reset' | 'floating_rate_reset' | 'property_buy';
  loan_draft?: LoanPayload;
  /** 1-based sim month at which the event takes effect. */
  effective_month: number;
  /** SALARY_RESET payload. */
  new_annual_gross?: string;
  new_monthly_take_home?: string;
  /** FLOATING_RATE_RESET payload. */
  loan_index?: number;
  new_rate?: string;
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

/** The minus goes before the symbol ("−₹29,200", not "₹-29,200"), and an
 *  amount that rounds to zero has no sign. Blank or non-numeric input is
 *  0 rather than a throw. */
function signed(
  value: string | number | Decimal,
  places: number,
  body: (abs: Decimal) => string,
): string {
  const d = dec(value);
  const neg = d.isNegative() && !d.abs().toDecimalPlaces(places).isZero();
  return `${neg ? '−' : ''}${body(d.abs())}`;
}

/** Rupees with lakh comma format. ₹1,23,45,678 — exact, no abbreviation. */
export function formatINR(value: string | number | Decimal): string {
  return signed(value, 0, (d) => `₹${indianGroup(d.toFixed(0))}`);
}

/** Dollars with Western comma format. $1,234,567.89 — exact, no abbreviation. */
export function formatUSD(value: string | number | Decimal): string {
  return signed(value, 2, (d) => {
    const [intPart, decPart] = d.toFixed(2).split('.');
    return `$${westernGroup(intPart)}.${decPart}`;
  });
}

/** Compact INR for chart axes / tight stat tiles. Uses Cr/L/k abbreviation. */
export function formatINRCompact(value: string | number | Decimal): string {
  return signed(value, 0, (d) => {
    if (d.gte(10_000_000)) return `₹${d.div(10_000_000).toFixed(2)}Cr`;
    if (d.gte(100_000)) return `₹${d.div(100_000).toFixed(2)}L`;
    if (d.gte(1_000)) return `₹${d.div(1_000).toFixed(1)}k`;
    return `₹${d.toFixed(0)}`;
  });
}

/** Compact USD for chart axes / tight stat tiles. Uses M/k abbreviation. */
export function formatUSDCompact(value: string | number | Decimal): string {
  return signed(value, 2, (d) => {
    if (d.gte(1_000_000)) return `$${d.div(1_000_000).toFixed(2)}M`;
    if (d.gte(1_000)) return `$${d.div(1_000).toFixed(1)}k`;
    return `$${d.toFixed(2)}`;
  });
}

/** POST /api/simulate body. */
export interface SimulateArgs {
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
  /** Planned future lifecycle events (salary_reset / floating_rate_reset).
   *  Each applies at its `effective_month` (1-based sim month). Confirmed
   *  past events are already baked into the profile via L1 immediate-
   *  apply and should NOT be included here (engine would double-apply). */
  lifecycle_events?: LifecycleEventInput[];
  /** Soft EF waterfall — fraction of each month's surplus diverted into
   *  the emergency fund until `efund_target` is hit. /plan sets 0.3 when
   *  `efund_balance < efund_target`; 0 otherwise. Default 0 preserves
   *  legacy "100% surplus → debt" behaviour. */
  ef_top_up_rate?: string;
  /** The user's monthly total for debts (EMIs + minimums + extra), in
   *  their currency. Omitted: all spare cash goes to debts. */
  debt_budget?: string;
  /** True when an active preempting goal exists (e.g. wedding, medical).
   *  The engine routes 100% surplus to the goal_slice in the allocation
   *  response when set. Default false preserves legacy behaviour. */
  ef_preempted?: boolean;
  /** Per-goal payloads — when set, engine runs serial-fill per
   *  month with goal-expiry awareness and returns per-goal slices
   *  in `surplus_allocation.goal_contributions` plus end-of-trajectory
   *  fill rates in `goal_finals`. */
  goals?: {
    id: string;
    target_month_index: number;
    required_amount: string;
    saved_so_far?: string;
    priority_bump?: boolean;
    order_index?: number | null;
    /** Deferred-start: engine routes 0 to this goal until this
     *  sim-month index. Lets the UI park a goal until later in the
     *  timeline. null = start at month 0 (legacy behavior). */
    funding_start_month_index?: number | null;
  }[];
}

/** The plan's settings for a run (everything /plan sends to /simulate
 *  but the strategy): handed to the what-if panel so its runs match. */
export type PlanRunArgs = Omit<SimulateArgs, 'strategy'>;

export function formatCurrency(value: string | number | Decimal, currency: string): string {
  return currency.toUpperCase() === 'USD' ? formatUSD(value) : formatINR(value);
}

/** Whole rupees or dollars ("$4,500", not "$4,500.00"): for amounts that
 *  are rounded anyway, such as this month's payments. */
export function formatCurrencyWhole(value: string | number | Decimal, currency: string): string {
  return currency.toUpperCase() === 'USD'
    ? signed(value, 0, (d) => `$${westernGroup(d.toFixed(0))}`)
    : formatINR(value);
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
  // Month 1 is the current month, so month N is N − 1 months away.
  const d = new Date(start.getFullYear(), start.getMonth() + monthIndex - 1, 1);
  return d.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
}
