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
    # Married filing separately (C17): half the MFJ mortgage-debt limit,
    # no §221 student-loan deduction (IRC §221(e)(2); IRS Topic 456).
    MFS = "mfs"


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
    GOLD_ETF = "gold_etf"           # listed units: long-term after 12 months (sprint G10)
    SGB = "sgb"
    REAL_ESTATE = "real_estate"
    PPF = "ppf"
    EPF = "epf"
    NPS = "nps"
    CRYPTO = "crypto"               # virtual digital asset: 30% in India (sprint G10)
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
    #     charges as a fee when you pay above-schedule. Blank means 0:
    #     assumed 0 for an Indian floating-rate loan (RBI Pre-payment
    #     Charges on Loans Directions, 2 July 2025, para 5(i)), unknown and
    #     not assumed otherwise (engine/prepayment_fee.py). With a fee, the
    #     Avalanche order is searched (engine/fee_order.py).
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
    # Smallest part-payment the lender accepts (grill #30, sprint G1), in the
    # loan's currency. Extra below it is set aside month to month until it
    # reaches this amount (MonthRow.set_aside_for_prepay). 0 = any amount.
    # From the loan agreement / KFS; no lender figure is ever assumed.
    min_prepay_amount: Decimal = Decimal("0")
    # Pre-EMI broken-period interest. Used for under-construction home
    # loans: lender disburses tranches before possession, charging
    # interest-only on the disbursed amount until full possession. EMI
    # principal repayment starts only after pre_emi_months_remaining
    # decrements to 0. Each sim-month: accrue interest, add to outstanding,
    # no principal reduction, decrement counter. Default 0 → no pre-EMI
    # period (post-possession or non-construction loan).
    pre_emi_months_remaining: int = 0
    # Sim month of the loan's first EMI. A loan taken this month usually
    # pays its first EMI next month (2): until then it's owed but neither
    # accrues nor pays (the first EMI covers its first month's interest).
    first_payment_month: int = 1
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
    # ── India tax inputs (sprint G2; engine/tax/india.py) ────────────────────
    # The user's share of this loan for tax: a co-borrower who is also a
    # co-owner claims their own share of the interest (s.24 of the 2025 Act
    # [1961: s.26] gives each co-owner the relief "as if individually
    # entitled") and of the principal in s.123 / 80C. 1 = the whole loan.
    tax_share: Decimal = Decimal("1")
    # Education loan, s.129 / 80E: months (from sim month 1) the deduction
    # can still be claimed; None = not known, 0 = the 8-year window has ended.
    tax_deduction_months_left: Optional[int] = None
    # Home loan, s.22(1)(c): this year's one-fifth of the interest paid
    # before the house was bought or finished (whole loan, before share).
    pre_construction_interest_annual: Decimal = Decimal("0")
    # Home loan, let out: the year's rent (whole house); None = not given.
    annual_rent: Optional[Decimal] = None
    # Home loan, self-occupied: False when the house wasn't finished within
    # 5 years of borrowing, which cuts the cap to ₹30,000 (s.22(2)(b)).
    sec24_full_cap: bool = True
    # Home loan: the lender is one Schedule XV para 3(a)(iii) lists (banks,
    # HFCs, employer…), so principal repaid counts under s.123 [80C] (C10).
    principal_80c_eligible: bool = True
    # ── US-only fields (engine/us_loans.py; grill #33, #34) ──────────────────
    # Student loans: "federal" | "private" | None (not marked; treated as
    # federal, so never refinanced privately). `forgiveness_track` "pslf" |
    # "idr" holds extra payments off the loan (they'd shrink what's forgiven).
    student_loan_kind: Optional[str] = None
    forgiveness_track: Optional[str] = None
    # Mortgages: monthly mortgage insurance paid on top of the payment, the
    # home's original value (lower of price and appraisal at purchase), and
    # its kind: "pmi" (conventional; ends at 80% of original value on
    # request) or "fha_mip" (runs `pmi_months_remaining` months, or for the
    # loan's life when blank). The simulator counts PMI as a monthly cost
    # until it ends.
    pmi_monthly: Decimal = Decimal("0")
    original_home_value: Optional[Decimal] = None
    mortgage_insurance_kind: Optional[str] = None
    pmi_months_remaining: Optional[int] = None
    # US mortgage taken on or before 15 Dec 2017: keeps the $1M ($500k MFS)
    # acquisition-debt limit of IRC §163(h)(3)(B)(ii) instead of $750k (C17).
    mortgage_before_2017_12_16: bool = False
    # US car loan whose interest is "qualified passenger vehicle loan
    # interest", IRC §163(h)(4) (OBBBA, P.L. 119-21 §70203; C16): taken after
    # 31 Dec 2024 for a NEW personal-use vehicle with final assembly in the
    # US, secured by a first lien. Only the user can tell (VIN plant); False
    # = not claimed. Tax years 2025-2028 only.
    us_auto_interest_qualified: bool = False


class LifecycleEventKind(str, Enum):
    """Discontinuous events the regular hike_schedule can't express.
    Property buys are handled outside the engine (L1 immediate-apply on
    confirm); only salary + rate resets are wired through simulate_plan."""
    SALARY_RESET = "salary_reset"
    FLOATING_RATE_RESET = "floating_rate_reset"
    PROPERTY_BUY = "property_buy"


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
    loan_draft: Optional[Loan] = None


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
    # Cost of selling, as a share of the sale value (brokerage + STT, a
    # jeweller's cut, an exit load). None = the engine's default for the
    # asset type (roadmap PR D: user-editable defaults).
    selling_cost_pct: Optional[Decimal] = None
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
class PayoffRules:
    """The user's own payoff order (roadmap PR E; replaces Hybrid).

    Loans are named by their position in `User.loans`.
    - `custom_order`: the full order the user set; loans it leaves out
      follow by highest effective rate. When set, the other rules are off.
    - `pinned`: loans moved to the front, in this order.
    - `small_first_below`: clear any loan under this balance (in the user's
      currency) first, smallest first. None = off.
    Everything else goes by highest effective rate (avalanche).
    """
    small_first_below: Optional[Decimal] = None
    pinned: list[int] = field(default_factory=list)
    custom_order: list[int] = field(default_factory=list)


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
    # India, old regime: s.123 [80C] items other than home-loan principal
    # this tax year (EPF, PPF, ELSS, life cover, tuition). None = not asked,
    # so no 80C room is assumed for a home-loan prepayment (C10).
    sec80c_other: Optional[Decimal] = None
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
    # The user's payoff rules when the strategy is RULES (engine/ordering.py).
    payoff_rules: Optional[PayoffRules] = None
    # ── The user's own assumptions (roadmap PR D); empty / None = defaults ──
    # Margin a loan's after-tax rate must beat the best liquid return by
    # before extra goes to it (formulas.PREPAY_RISK_PREMIUM, +0.5pp).
    prepay_hurdle: Optional[Decimal] = None
    # Expected yearly return per asset type, replacing country_data's table.
    asset_returns: dict[str, Decimal] = field(default_factory=dict)
    # Selling cost per asset type (share of sale value), replacing the
    # asset_liquidation defaults; an asset's own selling_cost_pct wins.
    liquidation_costs: dict[str, Decimal] = field(default_factory=dict)
    # FX rates used to convert non-residence-currency loan amounts (EMIs,
    # interest) into the user's residence currency for surplus / DTI math.
    # Keyed by loan currency ("INR", "USD", ...) with value = "how many
    # units of residence currency per 1 unit of loan currency" — same
    # direction as the /api/fx-rate endpoint returns. Missing key falls
    # back to 1.0 (parity), which is correct for the common single-
    # currency case where the helper is a no-op.
    fx_to_user_currency: Dict[str, Decimal] = field(default_factory=dict)
