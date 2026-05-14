"""Pydantic schemas — request/response envelopes mirroring engine dataclasses.

Decimal fields serialise as strings to preserve precision across the wire.
Each schema has `to_engine()` (build the engine dataclass) so route handlers
stay thin — they parse → convert → call engine → wrap in response model.
"""
from __future__ import annotations
from datetime import date
from decimal import Decimal
from typing import Optional

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
        )


class AssetIn(_Base):
    asset_type: str
    purchase_price: Decimal
    purchase_date: date
    current_market_value: Decimal
    rental_income_annual: Decimal = D("0")
    holding_costs_annual: Decimal = D("0")
    state: Optional[str] = None

    def to_engine(self) -> Asset:
        return Asset(
            asset_type=self.asset_type, purchase_price=self.purchase_price,
            purchase_date=self.purchase_date,
            current_market_value=self.current_market_value,
            rental_income_annual=self.rental_income_annual,
            holding_costs_annual=self.holding_costs_annual,
            state=self.state,
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
    annual_income: Decimal
    monthly_income: Decimal
    fixed_expenses: Decimal
    savings_balance: Decimal
    primary_bank: str
    location_tier: str = "urban"
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
    business_cagr: Decimal = D("0")
    inflation_rate: Decimal = D("0.046")

    def to_engine(self) -> User:
        return User(
            country=self.country, income_type=self.income_type,
            annual_income=self.annual_income, monthly_income=self.monthly_income,
            fixed_expenses=self.fixed_expenses,
            savings_balance=self.savings_balance,
            primary_bank=self.primary_bank, location_tier=self.location_tier,
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
            business_cagr=self.business_cagr,
            inflation_rate=self.inflation_rate,
        )


# ─────────────────────────────────────────────────────────────────────────────
# Simulation
# ─────────────────────────────────────────────────────────────────────────────

class SimulateRequest(_Base):
    user: UserIn
    strategy: Strategy = Strategy.AVALANCHE
    horizon_months: int = 360
    matched_contribution: Decimal = D("0")
    marginal_rate: Optional[Decimal] = None
    simple_mode: bool = False


class TrajectoryPoint(_Base):
    month: int
    balance: Decimal
    interest_paid: Decimal
    invested: Decimal


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
    # what-if knobs
    surplus_delta: Optional[Decimal] = None
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


class AssetLiquidationResponse(_Base):
    net_proceeds: Decimal
    ltcg_tax: Decimal
    net_benefit: Decimal
    asset_real_return_net: Decimal
    gate_1_net_benefit: bool
    gate_2_high_rate: bool
    gate_3_spread: bool
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


class RestructuringResponse(_Base):
    opportunities: list[RestructuringOpportunityOut]
    total_annual_saving: Decimal
