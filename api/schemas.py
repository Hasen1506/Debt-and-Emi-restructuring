"""Pydantic schemas — request/response envelopes mirroring engine dataclasses.

Decimal fields serialise as strings to preserve precision across the wire.
Each schema has `to_engine()` (build the engine dataclass) so route handlers
stay thin — they parse → convert → call engine → wrap in response model.
"""
from __future__ import annotations
from datetime import date
from decimal import Decimal
from typing import Dict, Optional

from pydantic import BaseModel, ConfigDict, Field

from engine.models import (
    Asset, Country, FilingStatusUS, IncomeType, InvestmentOption,
    LiquidityClass, Loan, LoanType, PFBalance, TaxRegimeIN, User,
)
from engine.layer0 import EmployerMatch
from engine.ordering import Strategy

D = Decimal


class _Base(BaseModel):
    model_config = ConfigDict(arbitrary_types_allowed=True)


# ─────────────────────────────────────────────────────────────────────────────
# Loan / Asset / Investment / PF
# ─────────────────────────────────────────────────────────────────────────────

class LoanIn(_Base):
    loan_type: LoanType
    bank: str
    outstanding: Decimal
    nominal_rate: Decimal
    rate_type: str = "floating"
    tenure_months_remaining: int
    scheduled_emi: Decimal
    processing_fee_amortised: Decimal = D("0")
    insurance_premium_pct: Decimal = D("0")
    property_use: Optional[str] = None
    min_payment_override: Optional[Decimal] = None
    currency: Optional[str] = None
    expected_monthly_spend: Decimal = D("0")
    # Optional statement / due day-of-month for credit cards (1-28).
    # UI-only — the engine's monthly-accrual model doesn't consume them.
    # Documented here so the schema surfaces the fields instead of
    # silently dropping them.
    statement_day: Optional[int] = None
    due_day: Optional[int] = None

    def to_engine(self) -> Loan:
        return Loan(
            loan_type=self.loan_type, bank=self.bank,
            outstanding=self.outstanding, nominal_rate=self.nominal_rate,
            rate_type=self.rate_type,
            tenure_months_remaining=self.tenure_months_remaining,
            scheduled_emi=self.scheduled_emi,
            processing_fee_amortised=self.processing_fee_amortised,
            insurance_premium_pct=self.insurance_premium_pct,
            property_use=self.property_use,
            min_payment_override=self.min_payment_override,
            currency=self.currency,
            expected_monthly_spend=self.expected_monthly_spend,
        )


class AssetIn(_Base):
    asset_type: str
    purchase_price: Decimal
    purchase_date: date
    current_market_value: Decimal
    rental_income_annual: Decimal = D("0")
    holding_costs_annual: Decimal = D("0")
    state: Optional[str] = None
    # Liquidation-advisor fields (all optional)
    label: Optional[str] = None
    expected_return_pct: Optional[Decimal] = None
    user_marks_liquid: bool = True
    fd_rate_pct: Optional[Decimal] = None
    fd_maturity_date: Optional[date] = None
    fd_premature_penalty_pct: Decimal = D("0.01")
    ppf_opened_date: Optional[date] = None
    sgb_at_maturity: bool = False
    us_section_121_eligible: bool = False
    us_is_tax_exempt_muni: bool = False

    def to_engine(self) -> Asset:
        return Asset(
            asset_type=self.asset_type, purchase_price=self.purchase_price,
            purchase_date=self.purchase_date,
            current_market_value=self.current_market_value,
            rental_income_annual=self.rental_income_annual,
            holding_costs_annual=self.holding_costs_annual,
            state=self.state,
            label=self.label,
            expected_return_pct=self.expected_return_pct,
            user_marks_liquid=self.user_marks_liquid,
            fd_rate_pct=self.fd_rate_pct,
            fd_maturity_date=self.fd_maturity_date,
            fd_premature_penalty_pct=self.fd_premature_penalty_pct,
            ppf_opened_date=self.ppf_opened_date,
            sgb_at_maturity=self.sgb_at_maturity,
            us_section_121_eligible=self.us_section_121_eligible,
            us_is_tax_exempt_muni=self.us_is_tax_exempt_muni,
        )


class InvestmentOptionIn(_Base):
    name: str
    expected_return: Decimal
    liquidity_class: LiquidityClass
    is_in_pool: bool = True

    def to_engine(self) -> InvestmentOption:
        return InvestmentOption(
            name=self.name, expected_return=self.expected_return,
            liquidity_class=self.liquidity_class, is_in_pool=self.is_in_pool,
        )


class CashAccountIn(_Base):
    """One cash account — checking / savings / HYSA / FD / other.
    Phase 1: pure data capture, engine doesn't consume. Phase 2+ will use
    per-account APY for the cash-vs-debt advisor and operational-float
    sacred-floor logic. `savings_balance` on UserIn remains the legacy
    aggregate and is kept in sync (= sum of optimizable balances) at the
    frontend save layer."""
    name: str
    balance: Decimal = D("0")
    apy: Decimal = D("0")
    kind: str = Field(..., pattern=r"^(checking|savings|hysa|fd|other)$")
    currency: Optional[str] = None


class PFBalanceIn(_Base):
    epf: Decimal = D("0")
    ppf: Decimal = D("0")
    nps_tier1: Decimal = D("0")
    nps_tier2: Decimal = D("0")
    years_in_service: int = 0
    years_since_ppf_open: int = 0
    years_since_nps_open: int = 0
    voluntary_pf_monthly: Decimal = D("0")
    ppf_monthly: Decimal = D("0")

    def to_engine(self) -> PFBalance:
        return PFBalance(**self.model_dump())


# ─────────────────────────────────────────────────────────────────────────────
# User
# ─────────────────────────────────────────────────────────────────────────────

class UserIn(_Base):
    country: Country
    income_type: IncomeType
    # Optional display name + coarse age bracket — pure UI metadata, not
    # consumed by the engine. Kept on the payload so the cookie round-trip
    # carries them and to_engine() simply drops them.
    display_name: Optional[str] = None
    age_bracket: Optional[str] = None
    annual_income: Decimal
    monthly_income: Decimal
    fixed_expenses: Decimal
    # Discretionary monthly outflows (eating out, travel, shopping) — what
    # the user would cut if they had to. Optional, defaults to 0 so legacy
    # payloads still validate; the WhatIf "trim spending" slider operates
    # on this bucket so it isn't asking the user to halve their rent.
    variable_expenses: Decimal = D("0")
    # Pre-tax annual income — salaried users fill annual_gross_salary
    # (Form 16 line 1), SE users fill annual_business_income (ITR Total
    # Income). Either one unlocks bracket display + tax-aware features;
    # leaving both blank falls back to the manual marginal_rate field.
    annual_gross_salary: Optional[Decimal] = None
    annual_business_income: Optional[Decimal] = None
    # Self-reported credit score — CIBIL (300-900) for India, FICO (300-850)
    # for US. Optional; engine doesn't consume it directly but it round-trips
    # so frontend rate-prediction chip can use the entered value across sessions.
    credit_score: Optional[int] = None
    savings_balance: Decimal
    # Optional rich per-account cash breakdown (checking / savings / HYSA /
    # FD / other). Engine drops it — used by /debts display and (Phase 2+)
    # the cash-vs-debt advisor. `savings_balance` above stays authoritative
    # for engine math; frontend keeps it in sync as the sum of optimizable
    # balances when cash_accounts is set.
    cash_accounts: list[CashAccountIn] = Field(default_factory=list)
    # Optional — annual tax owed on income NOT covered by employer TDS
    # (rental, FD interest > ₹40k, cap gains, freelance side-income).
    # Drives the tax-sleeve card on /debts for salaried users with non-
    # TDS income. Business owners ignore — their sleeve comes from
    # annual_business_income. Engine drops it.
    extra_income_annual_tax: Optional[Decimal] = None
    primary_bank: str
    location_tier: str = "urban"
    other_banks: list[str] = Field(default_factory=list)
    tax_regime: Optional[TaxRegimeIN] = None
    pf: Optional[PFBalanceIn] = None
    filing_status: Optional[FilingStatusUS] = None
    state: Optional[str] = None
    state_marginal_rate: Decimal = D("0")
    itemises: bool = False
    efund_balance: Decimal = D("0")
    efund_target: Decimal = D("0")
    loans: list[LoanIn] = Field(default_factory=list)
    assets: list[AssetIn] = Field(default_factory=list)
    investment_options: list[InvestmentOptionIn] = Field(default_factory=list)
    annual_hike_rate: Decimal = D("0")
    hike_effective_month: int = Field(default=1, ge=1, le=12)
    # Optional list of hike phases. Each entry: [year_from, year_to, rate].
    # year_from is 1-based inclusive, year_to is 1-based exclusive, rate
    # is annual decimal (0.08 = 8%). Empty list → engine uses annual_hike_rate
    # uniformly. Validated for non-overlap on the frontend; engine picks
    # the first matching phase regardless.
    hike_schedule: list[tuple[int, int, Decimal]] = Field(default_factory=list)
    business_cagr: Decimal = D("0")
    inflation_rate: Decimal = D("0.046")
    is_nri_us: bool = False
    fx_to_user_currency: Dict[str, Decimal] = Field(default_factory=dict)
    # Annualized FX drift per non-residence currency. Engine compounds
    # monthly: rate_at_m = spot × (1 + drift)^((m-1)/12). Empty / omitted
    # → no drift, FX stays flat at spot. Used by the NRI-US FX-drift toggle.
    fx_drift_annualized: Dict[str, Decimal] = Field(default_factory=dict)

    def to_engine(self) -> User:
        return User(
            country=self.country, income_type=self.income_type,
            annual_income=self.annual_income, monthly_income=self.monthly_income,
            fixed_expenses=self.fixed_expenses,
            variable_expenses=self.variable_expenses,
            annual_gross_salary=self.annual_gross_salary,
            annual_business_income=self.annual_business_income,
            credit_score=self.credit_score,
            savings_balance=self.savings_balance,
            primary_bank=self.primary_bank, location_tier=self.location_tier,
            other_banks=list(self.other_banks),
            tax_regime=self.tax_regime,
            pf=self.pf.to_engine() if self.pf else None,
            filing_status=self.filing_status, state=self.state,
            state_marginal_rate=self.state_marginal_rate,
            itemises=self.itemises,
            efund_balance=self.efund_balance, efund_target=self.efund_target,
            loans=[l.to_engine() for l in self.loans],
            assets=[a.to_engine() for a in self.assets],
            investment_options=[o.to_engine() for o in self.investment_options],
            annual_hike_rate=self.annual_hike_rate,
            hike_effective_month=self.hike_effective_month,
            hike_schedule=list(self.hike_schedule),
            business_cagr=self.business_cagr,
            inflation_rate=self.inflation_rate,
            is_nri_us=self.is_nri_us,
            fx_to_user_currency=dict(self.fx_to_user_currency),
            fx_drift_annualized=dict(self.fx_drift_annualized),
        )


# ─────────────────────────────────────────────────────────────────────────────
# Simulation
# ─────────────────────────────────────────────────────────────────────────────

class ReinvestEvent(_Base):
    """One auto-reinvest event for simulate_plan.

    Used by the "auto-reinvest tax savings" toggle on /plan — frontend
    pre-computes annual deductible-interest × marginal_rate and posts
    one event per fiscal year, timed to post-ITR-filing months.
    """
    month: int = Field(..., ge=1)
    amount: Decimal


class LifecycleEventIn(_Base):
    """Planned future event the engine should apply at its effective month.
    Past-confirmed events don't go here — the frontend bakes them into the
    profile via L1 immediate-apply before the simulate call. Only kind
    ∈ {salary_reset, floating_rate_reset} is supported by the engine;
    property_buy events stay L1-only because mid-loop dynamic loan
    addition cascades into response shape + ranking complexity."""
    kind: str = Field(..., pattern=r"^(salary_reset|floating_rate_reset)$")
    effective_month: int = Field(..., ge=1)
    new_annual_gross: Optional[Decimal] = None
    new_monthly_take_home: Optional[Decimal] = None
    loan_index: Optional[int] = Field(default=None, ge=0)
    new_rate: Optional[Decimal] = None


class SimulateRequest(_Base):
    user: UserIn
    strategy: Strategy = Strategy.AVALANCHE
    horizon_months: int = 360
    matched_contribution: Decimal = D("0")
    marginal_rate: Optional[Decimal] = None
    simple_mode: bool = False
    # 1=Jan, 12=Dec. Calendar month corresponding to sim month 1. Anchors
    # hike firing to the user's actual today. Defaults to 1 → preserves
    # legacy "hike at m=13" behaviour for callers that omit it.
    simulation_start_month: int = Field(default=1, ge=1, le=12)
    # Auto-reinvest events — empty / omitted preserves baseline behaviour.
    reinvest_events: list[ReinvestEvent] = Field(default_factory=list)
    # Inflate fixed + variable expenses month-over-month using user.inflation_rate.
    # Off by default so existing callers see no behavioural change.
    inflate_expenses: bool = False
    # Lifecycle events (planned future salary / rate resets). See
    # LifecycleEventIn — empty / omitted preserves baseline behaviour.
    lifecycle_events: list[LifecycleEventIn] = Field(default_factory=list)
    # Soft EF waterfall — fraction of each month's surplus diverted into
    # the emergency fund until `user.efund_target` is reached. /plan passes
    # 0.3 when `efund_balance < efund_target` and 0 otherwise. Default 0
    # preserves the legacy "100% surplus → debt" behaviour.
    ef_top_up_rate: Decimal = Field(default=D("0"), ge=D("0"), le=D("1"))


class TrajectoryPoint(_Base):
    month: int
    balance: Decimal
    interest_paid: Decimal
    invested: Decimal
    # Per-loan total payment this month, keyed by the loan's 0-based index in
    # the request's `user.loans`. Drives the period-aware "pay ₹X to {bank}"
    # rows in the Plan schedule. Empty after all loans clear.
    payments_by_loan_index: dict[int, Decimal] = Field(default_factory=dict)
    # Per-currency balance bucket. Keys are loan-currency codes ("INR", "USD").
    # For single-currency users this is a 1-element dict that matches
    # `balance` exactly. NRI-US hybrid users get one entry per loan currency
    # so the trajectory chart can render separate lines instead of summing
    # ₹ + $ into a misleading single number.
    balances_by_currency: dict[str, Decimal] = Field(default_factory=dict)
    # Per-loan outstanding this month, keyed by 0-based index in user.loans.
    # Drives the per-loan trajectory chart on /plan — each loan's curve
    # shrinks until it clears. Stays populated past the loan's clear date
    # with value 0 so chart consumers don't see disappearing series.
    balances_by_loan_index: dict[int, Decimal] = Field(default_factory=dict)


class SimulateResponse(_Base):
    debt_free_month: Optional[int]
    total_interest_paid: Decimal
    total_invested: Decimal
    trajectory: list[TrajectoryPoint]
    months_in_horizon: int


class BaselineRequest(_Base):
    user: UserIn
    horizon_months: int = 360
    simple_mode: bool = False


class CompareRequest(_Base):
    """For sensitivity comparisons — caller supplies the two scenarios."""
    user: UserIn
    horizon_months: int = 360
    marginal_rate: Optional[Decimal] = None
    strategy: Strategy = Strategy.AVALANCHE
    simulation_start_month: int = Field(default=1, ge=1, le=12)
    # what-if knobs
    surplus_delta: Optional[Decimal] = None
    surplus_delta_start_month: int = 1
    income_shock_months: Optional[int] = None
    rate_shock_delta: Optional[Decimal] = None
    rate_shock_floating_only: bool = True
    alt_strategy: Optional[Strategy] = None
    lump_sum_amount: Optional[Decimal] = None
    lump_sum_target_loan_index: Optional[int] = None


class CompareResponse(_Base):
    baseline_debt_free_month: Optional[int]
    scenario_debt_free_month: Optional[int]
    months_pulled_forward: Decimal
    interest_saved: Decimal
    extra_invested: Decimal


# ─────────────────────────────────────────────────────────────────────────────
# Decision modules
# ─────────────────────────────────────────────────────────────────────────────

class WindfallRequest(_Base):
    amount: Decimal
    user: UserIn
    marginal_rate: Optional[Decimal] = None
    strategy: Strategy = Strategy.AVALANCHE


class WindfallResponse(_Base):
    loan_label: str
    amount: Decimal
    rationale: str
    interest_avoided: Decimal
    invest_instead: bool
    investment_name: Optional[str]


class NewDebtRequest(_Base):
    list_price: Decimal
    cash_price_elsewhere: Decimal
    emi_offer_months: int
    emi_offer_monthly_payment: Decimal
    processing_fee: Decimal = D("0")
    user_savings_after_efund: Decimal = D("0")


class NewDebtResponse(_Base):
    list_price: Decimal
    cash_price: Decimal
    foregone_discount: Decimal
    processing_fee: Decimal
    total_real_cost: Decimal
    monthly_emi: Decimal
    effective_apr: Decimal
    verdict: str
    detail: str


class QuickRecomputeRequest(_Base):
    user: UserIn
    extra_payment: Decimal
    target_loan_index: int = 0
    strategy: Strategy = Strategy.AVALANCHE
    horizon_months: int = 360
    marginal_rate: Optional[Decimal] = None


class QuickRecomputeResponse(_Base):
    old_debt_free_month: Optional[int]
    new_debt_free_month: Optional[int]
    months_pulled_forward: int
    interest_saved: Decimal


class CashYieldRequest(_Base):
    idle_balance: Decimal
    current_yield: Decimal
    country: Country
    top_loan_effective_rate: Optional[Decimal] = None
    best_alt_yield: Optional[Decimal] = None
    alt_name: Optional[str] = None
    minimum_idle_threshold: Decimal = D("10000")


class CashYieldResponse(_Base):
    alert: bool                       # True if a recommendation was produced
    idle_balance: Optional[Decimal] = None
    current_yield: Optional[Decimal] = None
    best_alt_yield: Optional[Decimal] = None
    alt_name: Optional[str] = None
    annual_uplift: Optional[Decimal] = None
    beats_top_loan: Optional[bool] = None
    rationale: Optional[str] = None


class BorrowTimingRequest(_Base):
    current_rate: Decimal
    six_month_avg: Decimal
    consensus_change_bps: int
    months_to_decision: int
    urgency: str                      # "now" | "3m_ok" | "6m_ok"
    principal: Decimal
    tenure_months: int


class BorrowTimingResponse(_Base):
    current_rate: Decimal
    six_month_avg: Decimal
    consensus_change_bps: int
    months_to_decision: int
    urgency: str
    verdict: str
    estimated_savings: Decimal
    detail: str


# ─────────────────────────────────────────────────────────────────────────────
# Asset liquidation (§8c / §4.18)
# ─────────────────────────────────────────────────────────────────────────────

class AssetLiquidationRequest(_Base):
    asset: AssetIn
    sale_price: Decimal
    debt_balance: Decimal
    debt_effective_rate: Decimal
    taxable_income: Decimal
    asset_nominal_return: Decimal = D("0.06")
    inflation: Decimal = D("0.046")
    holding_cost_rate: Decimal = D("0.01")
    expected_hold_years_post_sale: Decimal = D("5")
    selling_period_months: int = 3
    high_rate_threshold: Decimal = D("0.20")
    purchase_fy: Optional[str] = None        # required if purchase pre-23-Jul-2024
    current_fy: Optional[str] = None
    brokerage_rate: Decimal = D("0.015")
    surplus_reinvestment_yield: Optional[Decimal] = None   # if absent, Gate 0 is skipped


class AssetLiquidationResponse(_Base):
    net_proceeds: Decimal
    ltcg_tax: Decimal
    net_benefit: Decimal
    asset_real_return_net: Decimal
    gate_1_net_benefit: bool
    gate_2_high_rate: bool
    gate_3_spread: bool
    gate_0_wealth_edge: Optional[bool] = None
    surplus: Optional[Decimal] = None              # net_proceeds − debt_balance
    wealth_hold: Optional[Decimal] = None
    wealth_sell: Optional[Decimal] = None
    wealth_edge: Optional[Decimal] = None
    horizon_years: Optional[Decimal] = None
    recommend_liquidation: bool
    rationale: str


# ─────────────────────────────────────────────────────────────────────────────
# Layer 0 — employer match
# ─────────────────────────────────────────────────────────────────────────────

class EmployerMatchIn(_Base):
    name: str
    annual_salary: Decimal
    match_cap_pct: Decimal
    match_rate: Decimal
    current_user_contribution_pct: Decimal
    expected_annual_return: Decimal
    years_to_retirement: int

    def to_engine(self) -> EmployerMatch:
        return EmployerMatch(**self.model_dump())


class EmployerMatchResponse(_Base):
    monthly_contribution_needed: Decimal
    pv_at_retirement: Decimal
    has_unmet_match: bool


# ─────────────────────────────────────────────────────────────────────────────
# Institutions / rate cards
# ─────────────────────────────────────────────────────────────────────────────

class RateRangeOut(_Base):
    low: Decimal
    high: Decimal
    median: Decimal


class InstitutionOut(_Base):
    institution_id: str
    country: Country
    name: str
    scrape_tier: str
    home_loan: Optional[RateRangeOut] = None
    personal_loan: Optional[RateRangeOut] = None
    auto_loan: Optional[RateRangeOut] = None
    education_loan: Optional[RateRangeOut] = None
    credit_card_apr_low: Optional[Decimal] = None
    credit_card_apr_high: Optional[Decimal] = None
    processing_fee_pct: Optional[Decimal] = None
    last_verified: str


class MarketMedianResponse(_Base):
    country: Country
    loan_type: LoanType
    median: Optional[Decimal]


# ─────────────────────────────────────────────────────────────────────────────
# Restructuring (§4.7) — Layer 1 scanner
# ─────────────────────────────────────────────────────────────────────────────

class RestructuringRequest(_Base):
    user: UserIn
    marginal_rate: Optional[Decimal] = None


class RestructuringOpportunityOut(_Base):
    kind: str                                # "balance_transfer" | "consolidation" | "refinance"
    headline: str
    rationale: str
    estimated_annual_saving: Decimal
    affected_loan_banks: list[str]
    target_bank: Optional[str] = None
    target_rate: Decimal
    current_rate: Decimal
    detail: dict[str, str]
    alternative_target_bank: Optional[str] = None
    alternative_target_rate: Optional[Decimal] = None
    alternative_annual_saving: Optional[Decimal] = None
    target_is_existing_relationship: bool = False


class RestructuringResponse(_Base):
    opportunities: list[RestructuringOpportunityOut]
    total_annual_saving: Decimal


# ─────────────────────────────────────────────────────────────────────────────
# Portfolio liquidation advisor (§4.18 — ranker over (asset, debt) pairs)
# ─────────────────────────────────────────────────────────────────────────────

class ProceedsResultOut(_Base):
    asset_label: str
    asset_type: str
    gross_proceeds: Decimal
    tax_owed: Decimal
    penalty: Decimal
    transaction_costs: Decimal
    net_proceeds: Decimal
    explanation: str
    is_blocked: bool = False
    block_reason: str = ""
    caveats: list[str] = Field(default_factory=list)


class LiquidationRecommendationOut(_Base):
    asset_index: int
    asset_label: str
    asset_type: str
    target_loan_index: int
    target_loan_label: str
    proceeds: ProceedsResultOut
    debt_balance: Decimal
    debt_effective_rate: Decimal
    debt_cleared_amount: Decimal
    interest_saved_yr1_nominal: Decimal
    asset_return_pct: Decimal
    holding_cost_given_up_yr1: Decimal
    net_annual_benefit_nominal: Decimal
    net_annual_benefit_real: Decimal
    verdict: str                              # clear_win | conditional | marginal | dont_sell
    skip_reason: Optional[str] = None


class LiquidationRankingsRequest(_Base):
    user: UserIn
    # Map of loan index → effective APR for that loan. Caller computes these
    # using the same effective-APR helper the UI already uses, so the ranker
    # uses consistent rates with what the user sees elsewhere.
    debt_effective_rates: dict[int, Decimal]
    marginal_rate: Decimal = D("0.30")
    high_rate_threshold: Decimal = D("0.20")
    horizon_years: Decimal = D("5")
    surplus_reinvestment_yield: Decimal = D("0.07")
    pre_filter_margin: Decimal = D("0.01")


class LiquidationRankingsResponse(_Base):
    recommendations: list[LiquidationRecommendationOut]
    considered_but_skipped: list[LiquidationRecommendationOut]
