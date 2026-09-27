"""Core data models. All money fields are Decimal; rates are Decimal in [0, 1]."""
from dataclasses import dataclass, field
from decimal import Decimal
from enum import Enum
from datetime import date
from typing import Dict, Optional


class Country(str, Enum):
    IN = "IN"
    US = "US"


class TaxRegimeIN(str, Enum):
    NEW = "new"
    OLD = "old"


class FilingStatusUS(str, Enum):
    SINGLE = "single"
    MFJ = "mfj"
    HOH = "hoh"


class IncomeType(str, Enum):
    SALARIED = "salaried"
    BUSINESS_OWNER = "business_owner"


class LoanType(str, Enum):
    HOME = "home_loan"
    AUTO = "auto_loan"
    PERSONAL = "personal_loan"
    CREDIT_CARD = "credit_card"
    EDUCATION = "education_loan"
    GOLD = "gold_loan"
    BNPL = "bnpl"


class LiquidityClass(str, Enum):
    LIQUID = "liquid"
    LOCKED = "locked"
    AGE_GATED = "age_gated"


class AssetType(str, Enum):
    """Canonical asset types for the liquidation advisor (§4.18 ranker)."""
    SAVINGS = "savings_balance"
    FIXED_DEPOSIT = "fixed_deposit"
    EQUITY_STOCKS = "equity_stocks"
    EQUITY_MF = "equity_mf"
    DEBT_MF = "debt_mf"
    GOLD_PHYSICAL = "gold_physical"
    SGB = "sgb"
    REAL_ESTATE = "real_estate"
    PPF = "ppf"
    EPF = "epf"
    NPS = "nps"
    OTHER = "other"


@dataclass
class Loan:
    loan_type: LoanType
    bank: str
    outstanding: Decimal
    nominal_rate: Decimal           # decimal, e.g. Decimal("0.0825")
    rate_type: str                  # "floating" | "fixed"
    tenure_months_remaining: int
    scheduled_emi: Decimal
    processing_fee_amortised: Decimal = Decimal("0")
    insurance_premium_pct: Decimal = Decimal("0")
    property_use: Optional[str] = None    # "self_occupied" | "let_out" for home loans
    # Optional user override for the credit-card minimum payment. When set,
    # the bank-specific formula in `minimum_payments.py` is bypassed. Ignored
    # for non-card loans (their minimum is `scheduled_emi` unambiguously).
    min_payment_override: Optional[Decimal] = None
    # Currency the loan is denominated in. None = follow the user's country
    # default (INR for IN-resident, USD for US-resident). Set explicitly when
    # the loan currency differs from the user's residence — e.g. an NRI on a
    # US work visa servicing an Indian home loan would tag their INR loans
    # `currency="INR"` while their User.country stays "US".
    currency: Optional[str] = None
    # For credit cards only: expected new spend the user puts on the card
    # each month. The simulator adds this to outstanding BEFORE computing
    # the minimum payment, then proceeds normally. Models real card
    # behaviour — outstanding doesn't only go down. Default 0 = "freeze
    # the card today" behaviour (the original assumption, kept for
    # backwards compatibility). Ignored on non-card loans.
    expected_monthly_spend: Decimal = Decimal("0")
    # Floating-rate scheduling (ignored when rate_type == "fixed"):
    #   • rate_reset_frequency_months — how often the bank re-prices the loan
    #     (RLLR / EBLR loans: monthly = 1; older MCLR: typically 6 or 12).
    #   • next_reset_month — 1-based sim month at which the next reset fires.
    #     /plan derives this from the calendar `next_reset_date` on the
    #     frontend before sending. Once consumed, the simulator schedules
    #     subsequent resets every `rate_reset_frequency_months` thereafter.
    #   • rate_drift_annualized — projected annual change in the benchmark
    #     rate (decimal; e.g. +0.005 = +50bps/yr). Applied at each reset
    #     so the trajectory reflects the user's repo-cut / hike thesis.
    # Defaults preserve legacy behaviour (no auto-reset).
    rate_reset_frequency_months: Optional[int] = None
    next_reset_month: Optional[int] = None
    rate_drift_annualized: Decimal = Decimal("0")
    # True-APR restructuring triggers (see project_brainstorm_backlog memo).
    # These mirror what's in lender T&Cs and bite when the user wants to
    # prepay aggressively or part-pay frequently. Defaults (0/None) keep
    # legacy callers running unchanged.
    #   • prepayment_penalty_pct  — % of the *extra* amount the bank
    #     charges as a fee when you pay above-schedule. RBI mandates 0 for
    #     individual floating-rate retail loans, so most India home/PL is
    #     0; fixed-rate or US loans frequently 2-4% within the lock-in.
    #   • prepay_lock_in_months   — number of sim-months from start during
    #     which any extra principal payment is rejected. Surplus that
    #     can't go anywhere flows to the next-priority loan via the
    #     ranker cascade.
    #   • part_payment_freq_months — restricts how often above-schedule
    #     payments can be made. 12 = once per calendar year; 1 = monthly
    #     OK. None = unlimited (the default).
    prepayment_penalty_pct: Decimal = Decimal("0")
    prepay_lock_in_months: int = 0
    part_payment_freq_months: Optional[int] = None
    # Pre-EMI broken-period interest. Used for under-construction home
    # loans: lender disburses tranches before possession, charging
    # interest-only on the disbursed amount until full possession. EMI
    # principal repayment starts only after pre_emi_months_remaining
    # decrements to 0. Each sim-month: accrue interest, add to outstanding,
    # no principal reduction, decrement counter. Default 0 → no pre-EMI
    # period (post-possession or non-construction loan).
    pre_emi_months_remaining: int = 0
    # Quoted rate basis. Most bank loans are quoted reducing-balance — the
    # interest each month is computed against the *outstanding* (the rate
    # the engine math expects). Consumer-durable + NBFC loans frequently
    # advertise a *flat* rate that's mathematically very different: "flat
    # 8% over 24mo" means total interest = 8% × 2yr × principal = 16% of
    # principal, which equates to ~14-15% APR on a reducing-balance basis.
    #
    # When `rate_basis = "flat"`, the schema layer converts `nominal_rate`
    # to its reducing-balance equivalent at to_engine() time using the
    # remaining tenure, so the engine math always sees reducing rates and
    # the comparison with bank loans stays apples-to-apples. Engine itself
    # never reads this field — it's a frontend / schema concern.
    rate_basis: str = "reducing"   # "flat" | "reducing"


class LifecycleEventKind(str, Enum):
    """Discontinuous events the regular hike_schedule can't express.
    Property buys are handled outside the engine (L1 immediate-apply on
    confirm); only salary + rate resets are wired through simulate_plan."""
    SALARY_RESET = "salary_reset"
    FLOATING_RATE_RESET = "floating_rate_reset"


@dataclass
class LifecycleEvent:
    """A planned future event the engine should apply at a specific
    simulation month. Confirmed past events don't go here — they're
    baked into the profile before the request hits the engine.

    `effective_month` is 1-based: 1 = "from sim start", 13 = "one year in".
    """
    kind: LifecycleEventKind
    effective_month: int
    # SALARY_RESET payload — exactly one of these two is required.
    new_annual_gross: Optional[Decimal] = None      # pre-tax annual; engine derives monthly
    new_monthly_take_home: Optional[Decimal] = None # net monthly (overrides derived)
    # FLOATING_RATE_RESET payload
    loan_index: Optional[int] = None  # 0-based index into user.loans
    new_rate: Optional[Decimal] = None  # decimal APR (e.g. 0.082)


@dataclass
class InvestmentOption:
    name: str
    expected_return: Decimal        # decimal, nominal pre-tax
    liquidity_class: LiquidityClass
    is_in_pool: bool                # False if locked / age-gated for this user


@dataclass
class Asset:
    asset_type: str                 # canonical values in AssetType enum
    purchase_price: Decimal
    purchase_date: date
    current_market_value: Decimal
    rental_income_annual: Decimal = Decimal("0")
    holding_costs_annual: Decimal = Decimal("0")
    state: Optional[str] = None     # for India stamp duty lookup
    # ── Liquidation-advisor fields (all optional) ────────────────────────────
    label: Optional[str] = None                       # user-facing name
    expected_return_pct: Optional[Decimal] = None     # nominal; override default
    user_marks_liquid: bool = True                    # "can I sell this in 30d?"
    # FD-specific
    fd_rate_pct: Optional[Decimal] = None
    fd_maturity_date: Optional[date] = None
    fd_premature_penalty_pct: Decimal = Decimal("0.01")
    # PPF-specific
    ppf_opened_date: Optional[date] = None
    # SGB-specific — if user is at the 8-year maturity, redemption is tax-free
    sgb_at_maturity: bool = False
    # US-specific — IRC §121 primary-residence capital-gains exclusion
    # ($250k single / $500k MFJ if lived in 2 of last 5 years). User confirms.
    us_section_121_eligible: bool = False
    # US-specific — set True for muni-bond mutual funds whose ordinary coupon
    # income is federally tax-exempt under §103. Capital gains on disposal
    # are still taxable, but the asset's expected return (`expected_return_pct`)
    # is recast to taxable-equivalent terms before being compared against
    # debt rates in the ranker — a 3.5% tax-exempt yield is closer to ~5.2%
    # for a 33% bracket holder, so the "should I sell to pay down debt"
    # math otherwise understates the asset's value.
    us_is_tax_exempt_muni: bool = False
    # Holdings tracker — populated for equity_stocks / equity_mf entries that
    # the user enters as ticker+quantity rather than a flat market value. When
    # set, `current_market_value` is derived as quantity × last_price and is
    # refreshed from the Yahoo Finance quote API on demand from the frontend.
    # Engine-side this is informational only; the liquidation advisor and the
    # /plan invest-vs-prepay card still consume `current_market_value`.
    ticker: Optional[str] = None
    quantity: Optional[Decimal] = None
    last_price: Optional[Decimal] = None
    last_price_at: Optional[str] = None         # ISO timestamp string
    # Per-asset projected appreciation (decimal annual CAGR; e.g. 0.07 = +7%/yr).
    # When set, future-value math (portfolio advisor, goal achievability,
    # liquidation timing) compounds the current_market_value forward by this
    # rate. None = use the country-default per asset_type from country_data.
    # Most useful for real_estate (regional CAGRs vary wildly) and gold,
    # where the user often has a strong view that differs from the default.
    appreciation_cagr: Optional[Decimal] = None


@dataclass
class PFBalance:
    epf: Decimal = Decimal("0")
    ppf: Decimal = Decimal("0")
    nps_tier1: Decimal = Decimal("0")
    nps_tier2: Decimal = Decimal("0")
    years_in_service: int = 0
    years_since_ppf_open: int = 0
    years_since_nps_open: int = 0
    voluntary_pf_monthly: Decimal = Decimal("0")
    ppf_monthly: Decimal = Decimal("0")


@dataclass
class User:
    country: Country
    income_type: IncomeType
    annual_income: Decimal
    monthly_income: Decimal
    fixed_expenses: Decimal
    savings_balance: Decimal
    primary_bank: str
    location_tier: str = "urban"    # "urban" | "semi_urban" | "rural"
    # Discretionary monthly outflows — eating out, travel, shopping. Splits
    # the old single "fixed_expenses" into truly-locked (rent, utilities)
    # and squeezable, so the WhatIf "cut spending" slider operates on a
    # bucket the user can actually trim. Defaults to 0 for old payloads.
    variable_expenses: Decimal = Decimal("0")
    # Pre-tax annual income. Salaried users fill `annual_gross_salary`
    # (Form 16 line 1 — gross before TDS, after CTC minus employer PF /
    # gratuity / insurance). Self-employed fill `annual_business_income`
    # (ITR Total Income — revenue minus business expenses + depreciation).
    # Mutually exclusive in practice; engine derives marginal_rate +
    # advance-tax liability from whichever is present. None means the
    # user provided only take-home, and we fall back to the manual
    # marginal_rate parameter on simulate calls.
    annual_gross_salary: Optional[Decimal] = None
    annual_business_income: Optional[Decimal] = None
    # Self-reported credit score (CIBIL 300-900 / FICO 300-850). Not used
    # in core engine math; preserved so frontend predictors (rate prefill,
    # risk band) can reference it without re-asking. None means "not
    # provided" — predictors fall back to income/employment-type heuristics.
    credit_score: Optional[int] = None
    # Banks the user holds accounts at (savings / current / DD) without an
    # active loan. Combined with the per-loan `bank` fields this gives the
    # full banking-relationship picture, so the new-debt and refinance
    # tools can suggest "borrow from a bank you already deal with" — no
    # new KYC, no extra account-opening cost.
    other_banks: list[str] = field(default_factory=list)
    # India
    tax_regime: Optional[TaxRegimeIN] = None
    pf: Optional[PFBalance] = None
    # USA
    filing_status: Optional[FilingStatusUS] = None
    state: Optional[str] = None
    state_marginal_rate: Decimal = Decimal("0")
    itemises: bool = False
    # Share (0–1) of US mortgage interest that lowers tax: itemised
    # deductions above the standard deduction, over the mortgage interest.
    itemised_share: Decimal = Decimal("1")
    # Common
    efund_balance: Decimal = Decimal("0")
    efund_target: Decimal = Decimal("0")
    loans: list[Loan] = field(default_factory=list)
    assets: list[Asset] = field(default_factory=list)
    investment_options: list[InvestmentOption] = field(default_factory=list)
    annual_hike_rate: Decimal = Decimal("0")
    # Calendar month (1-12) when the user's annual hike kicks in. Defaults
    # to January (1). India FY starts April → IN users typically set this
    # to 4. US users typically stay on January. Engine uses this together
    # with `simulation_start_month` to anchor hike firing to the right
    # calendar month instead of "month-13 from sim start".
    hike_effective_month: int = 1
    # Optional hike phases for users who expect varied hike rates over
    # time (e.g. "first 2 yrs 7%, next 4 yrs 10%, job switch at year 6").
    # Each phase is (year_from_inclusive, year_to_exclusive, rate). When
    # present, takes precedence over annual_hike_rate inside the year range.
    # Years are 1-based: phase (1, 3, 0.07) means rate 7% applies to the
    # hike events firing in years 1 and 2 of the simulation. Year-to is
    # exclusive so phases tile cleanly. Empty list = use annual_hike_rate
    # uniformly (legacy behaviour preserved).
    hike_schedule: list[tuple[int, int, Decimal]] = field(default_factory=list)
    business_cagr: Decimal = Decimal("0")
    inflation_rate: Decimal = Decimal("0.046")    # RBI MPC Apr 2026: CPI 4.6% FY26-27
    # NRI on a US work visa. Tax-resident in the US (W-2 / 1099 income, USD)
    # while still servicing Indian-origin debts (home loan, family obligations).
    # When True, country stays "US" but loans may be tagged `currency="INR"`,
    # and FX-aware affordability surfaces in the UI. Other NRI archetypes
    # (NRI-UK, NRI-Gulf) aren't modelled in Phase 1.
    is_nri_us: bool = False
    # Annualized FX drift per non-residence loan currency. Same key shape
    # as fx_to_user_currency. When non-empty, simulate_plan compounds the
    # drift into the FX rate each month: rate_at_m = spot × (1 + drift)^((m-1)/12).
    # Default empty → no drift, FX stays flat at spot for the whole horizon
    # (legacy behaviour). Used by the /plan FX-drift toggle for NRI-US
    # hybrid users; for them a small positive drift on INR captures the
    # long-run inflation-differential view that the rupee depreciates
    # ~2.5%/yr vs USD. Setting drift > 0 on the *residence* currency
    # itself is a no-op since to_user_currency short-circuits parity.
    fx_drift_annualized: dict[str, Decimal] = field(default_factory=dict)
    # FX rates used to convert non-residence-currency loan amounts (EMIs,
    # interest) into the user's residence currency for surplus / DTI math.
    # Keyed by loan currency ("INR", "USD", ...) with value = "how many
    # units of residence currency per 1 unit of loan currency" — same
    # direction as the /api/fx-rate endpoint returns. Missing key falls
    # back to 1.0 (parity), which is correct for the common single-
    # currency case where the helper is a no-op.
    fx_to_user_currency: Dict[str, Decimal] = field(default_factory=dict)
