"""Pydantic schemas — request/response envelopes mirroring engine dataclasses.

Decimal fields serialise as strings to preserve precision across the wire.
Each schema has `to_engine()` (build the engine dataclass) so route handlers
stay thin — they parse → convert → call engine → wrap in response model.
"""
from __future__ import annotations
from datetime import date
from decimal import Decimal
from typing import Annotated, Any, Dict, Literal, Optional

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, field_validator, model_validator

from engine.models import (
    Asset, Country, FilingStatusUS, IncomeType, InvestmentOption,
    LiquidityClass, Loan, LoanType, PFBalance, TaxRegimeIN, User,
)
from engine.formulas import flat_to_reducing
from engine.layer0 import EmployerMatch
from engine.ordering import Strategy

D = Decimal


class _Base(BaseModel):
    model_config = ConfigDict(arbitrary_types_allowed=True)


# ─────────────────────────────────────────────────────────────────────────────
# Input bounds
#
# Anything outside these is a typing slip or an attack, and they keep the
# engines' month-by-month loops short. Before them, numbers like 1E+999999
# crashed ten endpoints and 500 loans in one request were accepted
# (api/tests/test_api_fuzz.py). Request bodies subclass _In; responses
# don't, so a large projected figure can never fail on the way out.
# ─────────────────────────────────────────────────────────────────────────────

MAX_AMOUNT = D("1e12")          # ₹1 lakh crore / $1 trillion
MAX_INT = 100_000
MAX_MONTHS = 1200               # the plan horizon is 100 years
MAX_LOANS = 50
MAX_ITEMS = 100
MAX_TEXT = 200


def _check_bounds(v: Any) -> Any:
    if isinstance(v, Decimal):
        if not v.is_finite():
            raise ValueError("must be a finite number")
        if abs(v) > MAX_AMOUNT:
            raise ValueError("numbers above 1,000,000,000,000 are not accepted")
    elif isinstance(v, bool):
        pass
    elif isinstance(v, int):
        if abs(v) > MAX_INT:
            raise ValueError(f"whole numbers above {MAX_INT:,} are not accepted")
    elif isinstance(v, str):
        if len(v) > MAX_TEXT:
            raise ValueError(f"text longer than {MAX_TEXT} characters is not accepted")
    elif isinstance(v, (list, tuple)):
        if len(v) > MAX_ITEMS:
            raise ValueError(f"more than {MAX_ITEMS} entries are not accepted")
        for x in v:
            _check_bounds(x)
    elif isinstance(v, dict):
        if len(v) > MAX_ITEMS:
            raise ValueError(f"more than {MAX_ITEMS} entries are not accepted")
        for k, x in v.items():
            _check_bounds(k)
            _check_bounds(x)
    return v


def _amount(v: Decimal) -> Decimal:
    if v < 0:
        raise ValueError("can't be negative")
    return v


def _rate(v: Decimal) -> Decimal:
    if v < 0:
        raise ValueError("a rate can't be negative")
    if v > 1:
        raise ValueError(
            f"rates are fractions of 1: send {v / 100:f} for {v:f}%. "
            f"Rates above 100% a year are not accepted"
        )
    return v


Amount = Annotated[Decimal, AfterValidator(_amount)]
Rate = Annotated[Decimal, AfterValidator(_rate)]
SignedRate = Annotated[Decimal, Field(ge=-1, le=1)]
Months = Annotated[int, Field(ge=0, le=MAX_MONTHS)]
Horizon = Annotated[int, Field(ge=1, le=MAX_MONTHS)]
LoanIndex = Annotated[int, Field(ge=0, lt=MAX_LOANS)]
# An effective APR (fees included) can pass 100% on a short BNPL plan.
EffectiveRate = Annotated[Decimal, Field(ge=0, le=10)]


class _In(_Base):
    """Request bodies: every number finite and bounded, text and lists short."""

    @field_validator("*", mode="after")
    @classmethod
    def _bounded(cls, v: Any) -> Any:
        return _check_bounds(v)

    @model_validator(mode="after")
    def _valid_lifecycle_loans(self):
        user = getattr(self, "user", None)
        events = getattr(self, "lifecycle_events", [])
        if user is None or not events:
            return self
        drafts = [e.loan_draft for e in events if e.kind == "property_buy" and e.loan_draft is not None]
        if len(user.loans) + len(drafts) > MAX_LOANS:
            raise ValueError("Existing and planned loans together must not exceed 50")
        own = "INR" if user.country == Country.IN else "USD"
        for draft in drafts:
            if draft.outstanding <= 0 or draft.scheduled_emi <= 0 or draft.tenure_months_remaining <= 0:
                raise ValueError("Planned loans need positive principal, EMI and tenure")
            currency = draft.currency or own
            if currency not in ("INR", "USD"):
                raise ValueError("Planned loan currency must be INR or USD")
            if currency != own and user.fx_to_user_currency.get(currency, D("0")) <= 0:
                raise ValueError("Save an exchange rate for the planned loan currency")
        for event in events:
            if event.kind == "floating_rate_reset" and event.loan_index is not None and event.loan_index >= len(user.loans):
                raise ValueError("Rate reset must reference an existing loan")
        return self


# ─────────────────────────────────────────────────────────────────────────────
# Loan / Asset / Investment / PF
# ─────────────────────────────────────────────────────────────────────────────

class LoanIn(_In):
    loan_type: LoanType
    bank: str = Field(..., max_length=120)
    outstanding: Amount
    nominal_rate: Rate
    rate_type: str = "floating"
    tenure_months_remaining: Months
    scheduled_emi: Amount
    processing_fee_amortised: Amount = D("0")
    insurance_premium_pct: Decimal = D("0")
    property_use: Optional[str] = None
    min_payment_override: Optional[Amount] = None
    currency: Optional[str] = None
    expected_monthly_spend: Amount = D("0")
    # Optional statement / due day-of-month for credit cards (1-28).
    # UI-only — the engine's monthly-accrual model doesn't consume them.
    # Documented here so the schema surfaces the fields instead of
    # silently dropping them.
    statement_day: Optional[int] = Field(None, ge=1, le=31)
    due_day: Optional[int] = Field(None, ge=1, le=31)
    # Floating-rate scheduling — only meaningful when rate_type == "floating".
    # See engine/models.py:Loan for semantics. next_reset_month is 1-based
    # against the simulation; the frontend derives it from a calendar
    # next_reset_date before sending.
    rate_reset_frequency_months: Optional[int] = Field(None, ge=1, le=MAX_MONTHS)
    next_reset_month: Optional[int] = Field(None, ge=1, le=MAX_MONTHS)
    rate_drift_annualized: SignedRate = D("0")
    # True-APR restructuring triggers — see engine/models.py:Loan docstring.
    prepayment_penalty_pct: Decimal = D("0")
    prepay_lock_in_months: Months = 0
    part_payment_freq_months: Optional[int] = Field(None, ge=1, le=MAX_MONTHS)
    pre_emi_months_remaining: Months = 0
    # Quoted rate basis — "flat" (consumer-durable / NBFC quote) or
    # "reducing" (bank quote). Converted to reducing at to_engine().
    rate_basis: str = "reducing"
    # Optional UI-only labelling for credit cards. Engine ignores both.
    card_last_6: Optional[str] = None
    cardholder_name: Optional[str] = None

    def to_engine(self) -> Loan:
        # Convert flat-quoted consumer-durable / NBFC rates to their
        # reducing-balance equivalent so the engine math (which assumes
        # reducing) stays consistent. No-op for the default "reducing"
        # case which covers all bank quotes.
        effective_rate = self.nominal_rate
        if self.rate_basis == "flat" and self.tenure_months_remaining > 0:
            effective_rate = flat_to_reducing(
                self.nominal_rate, self.tenure_months_remaining,
            )
        return Loan(
            loan_type=self.loan_type, bank=self.bank,
            outstanding=self.outstanding, nominal_rate=effective_rate,
            rate_type=self.rate_type,
            tenure_months_remaining=self.tenure_months_remaining,
            scheduled_emi=self.scheduled_emi,
            processing_fee_amortised=self.processing_fee_amortised,
            insurance_premium_pct=self.insurance_premium_pct,
            property_use=self.property_use,
            min_payment_override=self.min_payment_override,
            currency=self.currency,
            expected_monthly_spend=self.expected_monthly_spend,
            rate_reset_frequency_months=self.rate_reset_frequency_months,
            next_reset_month=self.next_reset_month,
            rate_drift_annualized=self.rate_drift_annualized,
            prepayment_penalty_pct=self.prepayment_penalty_pct,
            prepay_lock_in_months=self.prepay_lock_in_months,
            part_payment_freq_months=self.part_payment_freq_months,
            pre_emi_months_remaining=self.pre_emi_months_remaining,
            rate_basis=self.rate_basis,
        )


class AssetIn(_In):
    asset_type: str
    purchase_price: Amount
    purchase_date: date
    current_market_value: Amount
    rental_income_annual: Amount = D("0")
    holding_costs_annual: Amount = D("0")
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
    # Holdings tracker fields — see Asset docstring in engine/models.py
    ticker: Optional[str] = None
    quantity: Optional[Amount] = None
    last_price: Optional[Amount] = None
    last_price_at: Optional[str] = None
    appreciation_cagr: Optional[Decimal] = None

    @field_validator("purchase_date", "fd_maturity_date", "ppf_opened_date", mode="before")
    @classmethod
    def _partial_date(cls, v: Any) -> Any:
        # The profile's asset form saves "2019" when the user only knows the
        # year, and the liquidate tool takes "2019-06". Both used to fail as
        # dates, so every call carrying the profile (the plan included)
        # returned 422. A bare year reads as 1 October, mid financial year.
        if isinstance(v, str):
            t = v.strip()
            if len(t) == 4 and t.isdigit():
                return f"{t}-10-01"
            if len(t) == 7 and t[:4].isdigit() and t[4] == "-" and t[5:].isdigit():
                return f"{t}-01"
        return v

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
            ticker=self.ticker,
            quantity=self.quantity,
            last_price=self.last_price,
            last_price_at=self.last_price_at,
            appreciation_cagr=self.appreciation_cagr,
        )


class InvestmentOptionIn(_In):
    name: str
    expected_return: Decimal
    liquidity_class: LiquidityClass
    is_in_pool: bool = True

    def to_engine(self) -> InvestmentOption:
        return InvestmentOption(
            name=self.name, expected_return=self.expected_return,
            liquidity_class=self.liquidity_class, is_in_pool=self.is_in_pool,
        )


class IncomeStreamIn(_In):
    """One income stream entry. Multiple streams capture concurrent
    sources or transitions across time. Engine drops these — frontend
    uses them to derive monthly_income and dynamic tax-sleeve targets.
    """
    id: str
    kind: str = Field(..., pattern=r"^(salaried|business_owner|freelance|rental|capital_gains|other)$")
    label: str
    gross_annual: Decimal
    start_date: str
    end_date: Optional[str] = None
    tds_pct: Optional[Decimal] = None


class DeductionsIn(_In):
    """Old-regime + itemized deductions captured at onboarding.

    Drives a more accurate derived marginal_rate display and the tax
    breakdown panel; engine consumes only the resulting marginal_rate
    today, so these fields don't flow through to_engine().
    """
    # India — old regime only
    hra_claim_annual: Optional[Decimal] = None
    rent_paid_annual: Optional[Decimal] = None
    sec_80c_annual: Optional[Decimal] = None
    sec_80d_annual: Optional[Decimal] = None
    sec_80e_annual: Optional[Decimal] = None
    sec_80ccd1b_annual: Optional[Decimal] = None
    # US — itemize-vs-standard
    state_marginal_rate_override: Optional[Decimal] = None
    mortgage_interest_annual: Optional[Decimal] = None
    itemized_deductions_other: Optional[Decimal] = None


class CashAccountIn(_In):
    """One cash account — checking / savings / HYSA / FD / other.
    Phase 1: pure data capture, engine doesn't consume. Phase 2+ will use
    per-account APY for the cash-vs-debt advisor and operational-float
    sacred-floor logic. `savings_balance` on UserIn remains the legacy
    aggregate and is kept in sync (= sum of optimizable balances) at the
    frontend save layer."""
    name: str
    balance: Amount = D("0")
    apy: Decimal = D("0")
    kind: str = Field(..., pattern=r"^(checking|savings|hysa|fd|other)$")
    currency: Optional[str] = None


class PFBalanceIn(_In):
    epf: Amount = D("0")
    ppf: Amount = D("0")
    nps_tier1: Amount = D("0")
    nps_tier2: Amount = D("0")
    years_in_service: int = 0
    years_since_ppf_open: int = 0
    years_since_nps_open: int = 0
    voluntary_pf_monthly: Amount = D("0")
    ppf_monthly: Amount = D("0")

    def to_engine(self) -> PFBalance:
        return PFBalance(**self.model_dump())


# ─────────────────────────────────────────────────────────────────────────────
# User
# ─────────────────────────────────────────────────────────────────────────────

class UserIn(_In):
    country: Country
    income_type: IncomeType
    # Optional display name + coarse age bracket — pure UI metadata, not
    # consumed by the engine. Kept on the payload so the cookie round-trip
    # carries them and to_engine() simply drops them.
    display_name: Optional[str] = None
    age_bracket: Optional[str] = None
    annual_income: Amount
    monthly_income: Amount
    fixed_expenses: Amount
    # Discretionary monthly outflows (eating out, travel, shopping) — what
    # the user would cut if they had to. Optional, defaults to 0 so legacy
    # payloads still validate; the WhatIf "trim spending" slider operates
    # on this bucket so it isn't asking the user to halve their rent.
    variable_expenses: Amount = D("0")
    # Pre-tax annual income — salaried users fill annual_gross_salary
    # (Form 16 line 1), SE users fill annual_business_income (ITR Total
    # Income). Either one unlocks bracket display + tax-aware features;
    # leaving both blank falls back to the manual marginal_rate field.
    annual_gross_salary: Optional[Amount] = None
    annual_business_income: Optional[Amount] = None
    # Self-reported credit score — CIBIL (300-900) for India, FICO (300-850)
    # for US. Optional; engine doesn't consume it directly but it round-trips
    # so frontend rate-prediction chip can use the entered value across sessions.
    credit_score: Optional[int] = None
    savings_balance: Amount
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
    extra_income_annual_tax: Optional[Amount] = None
    primary_bank: str
    location_tier: str = "urban"
    other_banks: list[str] = Field(default_factory=list)
    tax_regime: Optional[TaxRegimeIN] = None
    pf: Optional[PFBalanceIn] = None
    filing_status: Optional[FilingStatusUS] = None
    state: Optional[str] = None
    state_marginal_rate: Rate = D("0")
    itemises: bool = False
    efund_balance: Amount = D("0")
    efund_target: Amount = D("0")
    loans: list[LoanIn] = Field(default_factory=list, max_length=MAX_LOANS)
    assets: list[AssetIn] = Field(default_factory=list)
    investment_options: list[InvestmentOptionIn] = Field(default_factory=list)
    annual_hike_rate: Decimal = Field(D("0"), ge=D("-0.5"), le=1)
    hike_effective_month: int = Field(default=1, ge=1, le=12)
    # Optional list of hike phases. Each entry: [year_from, year_to, rate].
    # year_from is 1-based inclusive, year_to is 1-based exclusive, rate
    # is annual decimal (0.08 = 8%). Empty list → engine uses annual_hike_rate
    # uniformly. Validated for non-overlap on the frontend; engine picks
    # the first matching phase regardless.
    hike_schedule: list[tuple[int, int, Decimal]] = Field(default_factory=list)
    business_cagr: Decimal = Field(D("0"), ge=D("-0.5"), le=1)
    inflation_rate: Decimal = Field(D("0.046"), ge=D("-0.1"), le=1)
    is_nri_us: bool = False
    fx_to_user_currency: Dict[str, Decimal] = Field(default_factory=dict)
    # Annualized FX drift per non-residence currency. Engine compounds
    # monthly: rate_at_m = spot × (1 + drift)^((m-1)/12). Empty / omitted
    # → no drift, FX stays flat at spot. Used by the NRI-US FX-drift toggle.
    fx_drift_annualized: Dict[str, Decimal] = Field(default_factory=dict)
    # Old-regime / itemized deductions. Engine drops these — used by the
    # frontend to derive a more accurate marginal_rate display + tax
    # breakdown. See `DeductionsIn` for field semantics.
    deductions: Optional["DeductionsIn"] = None
    income_streams: list[IncomeStreamIn] = Field(default_factory=list)

    def _itemised(self) -> tuple[bool, Decimal]:
        """US only: does this person itemise, and what share of their
        mortgage interest lowers their tax? Only itemised deductions above
        the standard deduction save anything, so a $350k mortgage at 6.75%
        ($23,625 of interest, $16,100 standard) saves tax on $7,525 of it:
        a share of 0.32. The shield used to switch fully on the moment the
        interest passed the standard deduction (6.75% effective at $230k,
        4.73% at $240k). The web app never sends `itemises`, so it is
        worked out from the deductions entered at onboarding; with none
        entered, mortgage interest is estimated from the US home loans."""
        if self.itemises:
            return True, D("1")
        if self.country != Country.US:
            return False, D("0")
        from engine.tax.usa import STANDARD_DEDUCTION_2026

        ded = self.deductions
        if ded is not None and ded.mortgage_interest_annual is not None:
            mortgage = ded.mortgage_interest_annual
        else:
            mortgage = sum(
                (l.outstanding * l.nominal_rate for l in self.loans
                 if l.loan_type == LoanType.HOME and (l.currency or "USD") == "USD"),
                D("0"),
            )
        other = (ded.itemized_deductions_other if ded is not None else None) or D("0")
        std = STANDARD_DEDUCTION_2026[self.filing_status or FilingStatusUS.SINGLE]
        above = mortgage + other - std
        if above <= 0 or mortgage <= 0:
            return False, D("0")
        return True, min(mortgage, above) / mortgage

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
            itemises=self._itemised()[0],
            itemised_share=self._itemised()[1],
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

class ReinvestEvent(_In):
    """One auto-reinvest event for simulate_plan.

    Used by the "auto-reinvest tax savings" toggle on /plan — frontend
    pre-computes annual deductible-interest × marginal_rate and posts
    one event per fiscal year, timed to post-ITR-filing months.
    """
    month: int = Field(..., ge=1, le=MAX_MONTHS)
    amount: Amount


class LifecycleEventIn(_In):
    """Planned future event the engine should apply at its effective month.
    Past-confirmed events don't go here — the frontend bakes them into the
    profile before the simulate call. Planned loans reserve stable
    positions after the user's existing loans."""
    kind: str = Field(..., pattern=r"^(salary_reset|floating_rate_reset|property_buy)$")
    effective_month: int = Field(..., ge=1, le=MAX_MONTHS)
    new_annual_gross: Optional[Amount] = None
    new_monthly_take_home: Optional[Amount] = None
    loan_index: Optional[LoanIndex] = None
    new_rate: Optional[Rate] = None
    loan_draft: Optional[LoanIn] = None

    @model_validator(mode="after")
    def complete_event(self):
        if self.kind == "salary_reset" and self.new_annual_gross is None and self.new_monthly_take_home is None:
            raise ValueError("Salary reset requires gross income or take-home")
        if self.kind == "floating_rate_reset" and (self.loan_index is None or self.new_rate is None):
            raise ValueError("Rate reset requires a loan index and new rate")
        if self.kind == "property_buy" and self.loan_draft is None:
            raise ValueError("Property buy requires a loan draft")
        return self


class SimulateRequest(_In):
    user: UserIn
    strategy: Strategy = Strategy.AVALANCHE
    horizon_months: Horizon = 360
    matched_contribution: Amount = D("0")
    marginal_rate: Optional[Rate] = None
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
    # Emergency-fund split — the share of each month's surplus that goes
    # to the fund until `user.efund_target` is reached (the /plan slider).
    # When given it is the only EF top-up; omitted, the engine holds back
    # a fixed gap / 12 each month instead.
    ef_top_up_rate: Optional[Decimal] = Field(default=None, ge=D("0"), le=D("1"))
    # True when the user has an active preempting goal open (e.g. medical
    # bill, planned wedding) that takes priority over EF + debt for the
    # goal's funding window. Drives the surplus_allocation routing in the
    # response: ef_preempted=True → 100% to goal_slice. Default False
    # preserves baseline behaviour for callers that omit it.
    ef_preempted: bool = False
    # Per-goal input — engine runs serial-fill allocation per month
    # with goal-expiry awareness, returning per-goal contributions in
    # `surplus_allocation.goal_contributions` so the SurplusWaterfall
    # can render slices without re-computing client-side. Empty list
    # means "no active goals" (cascade gets full surplus).
    goals: list[GoalIn] = Field(default_factory=list)


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
    # Pre-allocation surplus for this month — what the engine had to
    # route before goals / EF / debt took their slices. Lets client-side
    # achievability sum the actual series (which accounts for inflation,
    # hike, lifecycle events) instead of multiplying a single static
    # surplus by a month count. Defaults to 0 for clients that don't
    # populate it (mirrors MonthRow.available_surplus default).
    available_surplus: Decimal = Field(default=D("0"))
    # All payments this month and the part above each loan's minimum, both
    # in the user's currency (per-loan payments are in each loan's own).
    total_paid: Decimal = Field(default=D("0"))
    extra_paid: Decimal = Field(default=D("0"))
    # Income short of costs plus minimum payments this month (0 when covered).
    shortfall: Decimal = Field(default=D("0"))
    # Per-goal contribution this month, keyed by goal id. Populated only
    # when `goals` was passed to /simulate. Lets achievability subtract
    # higher-priority goals' actual draws (which expire after their
    # target dates) instead of a flat priorDraw approximation.
    goal_contributions: dict[str, Decimal] = Field(default_factory=dict)


class GoalIn(_In):
    """Per-goal input passed to /simulate. Mirrors
    engine.goals.GoalState — engine takes this list, runs serial-fill
    per month with goal-expiry awareness, and returns the per-month
    contributions via the simulator state plus a first-month snapshot
    in `surplus_allocation.goal_contributions` and an end-of-trajectory
    fill rate in `goal_finals`."""
    id: str
    # 0-based sim-month at which the goal needs to be funded. Set by
    # the client as (target_calendar_month - simulation_start_month).
    target_month_index: Months
    # Funded amount (= goal.amount × (1 + buffer_pct)). Decimal string.
    required_amount: Amount
    # User's saved-so-far on this goal. 0 when no contributions ledger.
    saved_so_far: Amount = D("0")
    # Single explicit priority override — when True, this goal is
    # funded ahead of goals with earlier target dates. Replaces the
    # 3-tier critical/important/discretionary model.
    priority_bump: bool = False
    # Stable within-group ordering (lower = earlier). Set by the
    # drag-to-reorder UI; None falls back to target-month ordering.
    order_index: int | None = None
    # Deferred-start: when set, engine routes 0 to this goal for every
    # current_sim_month < this value (emits a `deferred` queued_reason
    # row). Lets the UI park a goal until later in the timeline so
    # debt prepay gets the full surplus until funding kicks in. None
    # preserves the legacy "start at month 0" behavior.
    funding_start_month_index: int | None = None

    @model_validator(mode="after")
    def _validate_funding_window(self) -> "GoalIn":
        """Reject `funding_start_month_index >= target_month_index` —
        otherwise the engine emits `deferred` for every sim month and
        the goal silently funds 0 with no actionable UI signal. A
        stale cookie or buggy client can produce this shape; failing
        loudly at the API edge surfaces the bug instead of papering
        over it with a zero-funding result."""
        if self.funding_start_month_index is None:
            return self
        if self.funding_start_month_index < 0:
            raise ValueError(
                f"funding_start_month_index must be ≥ 0 (got "
                f"{self.funding_start_month_index})"
            )
        if self.funding_start_month_index >= self.target_month_index:
            raise ValueError(
                f"funding_start_month_index ({self.funding_start_month_index}) "
                f"must be before target_month_index "
                f"({self.target_month_index}); otherwise the goal can never "
                "fund. Clear the start month or move the target out."
            )
        return self


class GoalContributionOut(_Base):
    """Per-goal slice returned for the first sim month — feeds the
    SurplusWaterfall rendering. Mirrors engine.goals.GoalContribution."""
    goal_id: str
    amount: Decimal
    run_rate: Decimal
    # None when funded, else 'past_date' | 'over_funded' |
    # 'surplus_exhausted' | 'partial_fill' | 'deferred'. Lets the UI
    # explain why a goal didn't get its run-rate.
    queued_reason: str | None = None
    # Snapshot-only: 0-based sim-month index at which deferred funding
    # is scheduled to begin. Lets /plan render "starts month N" instead
    # of just "₹0 — deferred" with no horizon. None when not deferred.
    funding_start_month_index: int | None = None


class GoalFinalOut(_Base):
    """End-of-trajectory per-goal fill rate. Drives the "expected
    X% by your target" badge on /goals + /plan. Engine reads
    GoalState.saved_at_target after the trajectory finishes — if the
    goal's date fell within the horizon, that's the saved amount on
    the target month; otherwise the saved-so-far at horizon end."""
    goal_id: str
    required: Decimal
    saved_at_target: Decimal
    # saved_at_target / required, clamped to [0, 1]. Decimal string.
    fill_rate: Decimal
    # True when target month was reached within the simulated horizon.
    # When False, the user hasn't reached the goal yet within the
    # projection window — see `target_past_horizon` for whether that's
    # because the sim stopped early (debt-free) or genuinely missed.
    target_reached: bool
    # True when the goal's target month sits beyond the simulated
    # horizon — typically because the sim broke out at debt_free_month
    # before reaching it. Lets the UI render an honest "deadline is
    # past your debt-free month — fund manually after that" instead
    # of the misleading "not reached" tone. Always False when
    # target_reached is True.
    target_past_horizon: bool = False
    # True when saved_at_target ≥ required. Distinct from target_reached:
    # a goal can be `funded=True, target_reached=False` (sim broke out
    # early — e.g., debt-free at month 18, goal at month 24 — but the
    # accumulated saving already covers required). Without this, the UI
    # can't tell "missed the deadline" from "on track, horizon was short".
    funded: bool


class SurplusAllocationOut(_Base):
    """How the engine routes each month's surplus. Mirrors
    engine.surplus.SurplusAllocation. The /plan SurplusWaterfall card
    reads these values directly instead of re-deriving client-side, so
    the displayed pie can't drift from the engine's actual allocation."""
    surplus: Decimal
    goal_slice: Decimal
    ef_slice: Decimal
    debt_slice: Decimal
    ef_preempted: bool
    # ef_split fraction the engine applied (0..1). Echoed back so the UI
    # can render the "30% of surplus" note without re-reading the user
    # profile or the request payload.
    ef_split: Decimal
    # Per-goal first-month contributions. Populated when `goals` was
    # passed to /simulate; empty list otherwise. Lets SurplusWaterfall
    # render funded + queued goal rows from engine truth instead of a
    # client-side re-derivation that could drift.
    goal_contributions: list[GoalContributionOut] = Field(default_factory=list)
    # True when at least one active goal received less than its
    # run-rate this month. Drives the "some goals are short" banner
    # on /plan.
    any_goal_short: bool = False


class SimulateResponse(_Base):
    # 1 = this month. 0 = nothing is owed now (no loans, or all at 0);
    # None = not cleared within the horizon.
    debt_free_month: Optional[int]
    total_interest_paid: Decimal
    total_invested: Decimal
    trajectory: list[TrajectoryPoint]
    months_in_horizon: int
    # This month's income short of costs plus minimum payments (0 when
    # covered). While it's above 0 the plan's payments aren't funded, so
    # the debt-free date assumes money the user doesn't have.
    shortfall: Decimal = D("0")
    # Surplus allocation computed by the engine for the *first* month of
    # the simulation — the snapshot the /plan waterfall card renders.
    # Engine truth, not a client mirror.
    surplus_allocation: Optional[SurplusAllocationOut] = None
    # Per-goal end-of-trajectory fill rates. Populated when `goals` was
    # passed in the request — drives the "expected X% by your target"
    # badge on /goals + /plan. Empty list when no goals were sent.
    goal_finals: list[GoalFinalOut] = Field(default_factory=list)


class BaselineRequest(_In):
    user: UserIn
    horizon_months: Horizon = 360
    simple_mode: bool = False
    # Planned rate resets, so the minimums-only comparison sees the same
    # rates as the plan it is compared with.
    lifecycle_events: list[LifecycleEventIn] = Field(default_factory=list, max_length=500)


class CompareRequest(_In):
    """For sensitivity comparisons — caller supplies the two scenarios.

    The plan fields below are the same as SimulateRequest's, so both runs
    are the plan /plan shows (the sliders used to run a plainer one and
    their "before" date could differ from the plan's)."""
    user: UserIn
    horizon_months: Horizon = 360
    marginal_rate: Optional[Rate] = None
    strategy: Strategy = Strategy.AVALANCHE
    simulation_start_month: int = Field(default=1, ge=1, le=12)
    matched_contribution: Amount = D("0")
    simple_mode: bool = False
    reinvest_events: list[ReinvestEvent] = Field(default_factory=list)
    inflate_expenses: bool = False
    lifecycle_events: list[LifecycleEventIn] = Field(default_factory=list)
    ef_top_up_rate: Optional[Decimal] = Field(default=None, ge=D("0"), le=D("1"))
    goals: list[GoalIn] = Field(default_factory=list)
    # what-if knobs
    surplus_delta: Optional[Decimal] = None
    surplus_delta_start_month: int = Field(1, ge=1, le=MAX_MONTHS)
    income_shock_months: Optional[Months] = None
    rate_shock_delta: Optional[SignedRate] = None
    rate_shock_floating_only: bool = True
    alt_strategy: Optional[Strategy] = None
    lump_sum_amount: Optional[Amount] = None
    lump_sum_target_loan_index: Optional[LoanIndex] = None


class CompareResponse(_Base):
    baseline_debt_free_month: Optional[int]
    scenario_debt_free_month: Optional[int]
    months_pulled_forward: Decimal
    interest_saved: Decimal
    extra_invested: Decimal


# ─────────────────────────────────────────────────────────────────────────────
# Decision modules
# ─────────────────────────────────────────────────────────────────────────────

class WindfallRequest(_In):
    amount: Amount
    user: UserIn
    marginal_rate: Optional[Rate] = None
    strategy: Strategy = Strategy.AVALANCHE


class WindfallResponse(_Base):
    loan_label: str
    # Position in user.loans of the loan the money goes to (None when it is
    # invested), so the client logs the payment against that loan.
    loan_index: Optional[int] = None
    amount: Decimal
    rationale: str
    interest_avoided: Decimal               # never negative; "given up" when investing
    invest_instead: bool
    investment_name: Optional[str]
    investment_return: Optional[Decimal] = None
    leftover: Decimal = D("0")
    # What interest_avoided assumes ("until the card is cleared, paying the
    # bank's minimum each month" / "over the loan's remaining life, ...").
    interest_basis: str = ""
    # The loan's prepayment fee on `amount` (taken out of it) and the interest
    # avoided less that fee.
    fee: Decimal = D("0")
    net_benefit: Decimal = D("0")
    # Loans passed over because their terms bar an extra payment now.
    blocked: list[str] = []


class NewDebtRequest(_In):
    list_price: Amount
    cash_price_elsewhere: Amount
    emi_offer_months: Months
    emi_offer_monthly_payment: Amount
    processing_fee: Amount = D("0")
    user_savings_after_efund: Amount = D("0")
    country: Country = Country.IN           # currency in the wording
    # Income − costs − payments already owed, per month (negative when
    # short). Sent from the profile; an EMI above it isn't "take".
    monthly_room: Optional[Decimal] = Field(None, ge=D("-1e12"), le=D("1e12"))


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


class QuickRecomputeRequest(_In):
    user: UserIn
    extra_payment: Amount
    target_loan_index: LoanIndex = 0
    strategy: Strategy = Strategy.AVALANCHE
    horizon_months: Horizon = 360
    marginal_rate: Optional[Rate] = None


class QuickRecomputeResponse(_Base):
    old_debt_free_month: Optional[int]
    new_debt_free_month: Optional[int]
    months_pulled_forward: int
    interest_saved: Decimal


class CashYieldRequest(_In):
    idle_balance: Amount
    current_yield: Rate
    country: Country
    top_loan_effective_rate: Optional[EffectiveRate] = None
    best_alt_yield: Optional[Rate] = None
    alt_name: Optional[str] = None
    minimum_idle_threshold: Amount = D("10000")


class CashYieldResponse(_Base):
    alert: bool                       # True if a recommendation was produced
    idle_balance: Optional[Decimal] = None
    current_yield: Optional[Decimal] = None
    best_alt_yield: Optional[Decimal] = None
    alt_name: Optional[str] = None
    annual_uplift: Optional[Decimal] = None
    beats_top_loan: Optional[bool] = None
    rationale: Optional[str] = None


class OddsOutcomeOut(_Base):
    bps: int                # the move: -25 is a 0.25% cut
    label: str              # as the market words it
    chance: Decimal         # 0–1


class OddsMeetingOut(_Base):
    date: str               # the decision day
    title: str
    url: str                # the market, to see it for yourself
    volume: Decimal         # US dollars traded
    cut_chance: Decimal
    rise_chance: Decimal
    outcomes: list[OddsOutcomeOut]


class RateOddsResponse(_Base):
    country: str
    source: str             # "Polymarket"
    fetched_at: Optional[str]
    meetings: list[OddsMeetingOut]   # soonest first; empty when none


class BorrowTimingRequest(_In):
    current_rate: Rate
    # Reported back only. Defaults to current_rate.
    six_month_avg: Optional[Rate] = None
    # Left out: the verdict goes on the market's odds for the coming
    # decisions. Given: the old path, on that expected move alone.
    consensus_change_bps: Optional[int] = Field(None, ge=-1000, le=1000)
    months_to_decision: Optional[int] = Field(None, ge=0, le=120)
    urgency: Literal["now", "3m_ok", "6m_ok"]
    principal: Amount
    tenure_months: int = Field(..., ge=1, le=MAX_MONTHS)
    # A floating rate follows the policy rate after you borrow.
    rate_type: Literal["fixed", "floating"] = "fixed"
    # Currency for the wording and the "worth waiting" threshold.
    country: Country = Country.IN
    # Left each month after costs and current payments, from the profile.
    # Can be negative (already short). The EMI has to fit in it.
    monthly_room: Optional[Decimal] = Field(None, ge=D("-1e12"), le=D("1e12"))


class BorrowTimingResponse(_Base):
    current_rate: Decimal
    six_month_avg: Decimal
    consensus_change_bps: int
    months_to_decision: int
    urgency: str
    verdict: str
    estimated_savings: Decimal
    detail: str
    monthly_payment: Decimal
    monthly_room: Optional[Decimal] = None
    # On the market's odds (the default path):
    cut_chance: Optional[Decimal] = None
    rise_chance: Optional[Decimal] = None
    saving_if_cut: Optional[Decimal] = None
    wait_until: Optional[str] = None
    rate_floats: bool = False
    odds: Optional[RateOddsResponse] = None


# ─────────────────────────────────────────────────────────────────────────────
# Asset liquidation (§8c / §4.18)
# ─────────────────────────────────────────────────────────────────────────────

class AssetLiquidationRequest(_In):
    asset: AssetIn
    sale_price: Amount
    debt_balance: Amount
    debt_effective_rate: EffectiveRate
    taxable_income: Amount
    # The loan's monthly payment. With it, keeping the asset pays the loan
    # down on schedule and invests the payment once it's cleared; without
    # it the debt is assumed to go unpaid and compound (a stress case).
    debt_monthly_payment: Optional[Amount] = None
    asset_nominal_return: SignedRate = D("0.06")
    inflation: Decimal = Field(D("0.046"), ge=D("-0.1"), le=1)
    holding_cost_rate: Rate = D("0.01")
    expected_hold_years_post_sale: Decimal = Field(D("5"), gt=0, le=100)
    selling_period_months: int = Field(3, ge=0, le=120)
    high_rate_threshold: Rate = D("0.20")
    # Default to the purchase date's FY and today's FY.
    purchase_fy: Optional[str] = None
    current_fy: Optional[str] = None
    brokerage_rate: Rate = D("0.015")
    surplus_reinvestment_yield: Optional[SignedRate] = None   # if absent, Gate 0 is skipped
    # Slab rate incl. surcharge + cess, used when the property was held 24
    # months or less (short-term). Derived from taxable_income if absent.
    marginal_rate: Optional[Rate] = None
    # Whose tax rules apply to the sale. A US seller pays federal capital-
    # gains tax (with the §121 main-home exclusion when `asset.
    # us_section_121_eligible`), NIIT and state tax, not India's LTCG.
    country: Country = Country.IN
    filing_status: Optional[FilingStatusUS] = None
    state_marginal_rate: Optional[Rate] = None


class AssetLiquidationResponse(_Base):
    net_proceeds: Decimal
    ltcg_tax: Decimal
    # How the tax was worked out, for the page to show next to the figure:
    # the rules used, any exclusion and what the user should check.
    tax_notes: list[str] = []
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
    # The edge selling must reach to pass Gate 0 (10% of the asset).
    wealth_edge_needed: Optional[Decimal] = None
    # "amortising": the loan is paid on schedule on both paths;
    # "debt_compounds": no payment given, so the hold path lets it grow.
    wealth_basis: Optional[str] = None
    horizon_years: Optional[Decimal] = None
    recommend_liquidation: bool
    rationale: str


# ─────────────────────────────────────────────────────────────────────────────
# Layer 0 — employer match
# ─────────────────────────────────────────────────────────────────────────────

class EmployerMatchIn(_In):
    name: str
    annual_salary: Amount
    match_cap_pct: Rate
    match_rate: Decimal = Field(..., ge=0, le=10)
    current_user_contribution_pct: Rate
    expected_annual_return: SignedRate
    years_to_retirement: int = Field(..., ge=0, le=80)

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


class MarketLowestResponse(_Base):
    """Cheapest Tier-A indicative rate for (country, loan_type). Surfaced
    by the goals achievability checker as the T3 (last-resort) new-loan
    suggestion. Indicative — partner-API integration is the eventual
    replacement (see [[project_deferred_2026_05_21]])."""
    country: Country
    loan_type: LoanType
    bank: Optional[str]
    low: Optional[Decimal]


class LoanTermsResponse(_Base):
    """Per-bank-per-loan-type True-APR triggers (prepay penalty, lock-in,
    part-payment frequency) merged with country/regulatory defaults.
    Feeds the onboarding click-to-fill UX so users see realistic
    suggestions instead of blank fields. See engine.rate_cards.lookup_loan_terms.

    `is_indicative=False` means the values came from a regulatory mandate
    (RBI master direction / CARD Act / QM rule) and the user can trust
    them as ground truth. `is_indicative=True` means typical industry
    norms — the UI surfaces this as a "confirm with sanction letter"
    caveat next to the suggestion."""
    country: Country
    loan_type: LoanType
    bank: Optional[str]
    rate_type: str
    prepayment_penalty_pct: Optional[Decimal]
    prepay_lock_in_months: Optional[int]
    part_payment_freq_months: Optional[int]
    is_indicative: bool = True
    last_verified: str = ""


# ─────────────────────────────────────────────────────────────────────────────
# Restructuring (§4.7) — Layer 1 scanner
# ─────────────────────────────────────────────────────────────────────────────

class RestructuringRequest(_In):
    user: UserIn
    marginal_rate: Optional[Rate] = None


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
    target_rate_as_of: Optional[str] = None
    # 0-based indices into the user's loan list this opportunity acts on.
    # Drives the "I took this — update terms" modal: refi/BT mutate the
    # indexed loan, consolidation rolls them up into a new loan.
    affected_loan_indices: list[int] = Field(default_factory=list)
    # Fee or switching cost paid up front; months to earn it back; for a
    # refinance, the saving over the rest of the loan after costs.
    # `estimated_annual_saving` is the first 12 months after that cost.
    one_time_cost: Decimal = Decimal("0")
    breakeven_months: Optional[int] = None
    lifetime_net_saving: Optional[Decimal] = None


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


class LiquidationRankingsRequest(_In):
    user: UserIn
    # Map of loan index → effective APR for that loan. Caller computes these
    # using the same effective-APR helper the UI already uses, so the ranker
    # uses consistent rates with what the user sees elsewhere.
    debt_effective_rates: dict[LoanIndex, EffectiveRate] = Field(..., max_length=MAX_LOANS)
    marginal_rate: Rate = D("0.30")
    high_rate_threshold: Rate = D("0.20")
    horizon_years: Decimal = Field(D("5"), gt=0, le=100)
    surplus_reinvestment_yield: SignedRate = D("0.07")
    pre_filter_margin: Rate = D("0.01")


class LiquidationRankingsResponse(_Base):
    recommendations: list[LiquidationRecommendationOut]
    considered_but_skipped: list[LiquidationRecommendationOut]
