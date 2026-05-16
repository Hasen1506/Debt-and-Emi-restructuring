"""Core data models. All money fields are Decimal; rates are Decimal in [0, 1]."""
from dataclasses import dataclass, field
from decimal import Decimal
from enum import Enum
from datetime import date
from typing import Optional


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


@dataclass
class InvestmentOption:
    name: str
    expected_return: Decimal        # decimal, nominal pre-tax
    liquidity_class: LiquidityClass
    is_in_pool: bool                # False if locked / age-gated for this user


@dataclass
class Asset:
    asset_type: str                 # "real_estate" | "equity" | "gold" | etc.
    purchase_price: Decimal
    purchase_date: date
    current_market_value: Decimal
    rental_income_annual: Decimal = Decimal("0")
    holding_costs_annual: Decimal = Decimal("0")
    state: Optional[str] = None     # for India stamp duty lookup


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
    business_cagr: Decimal = Decimal("0")
    inflation_rate: Decimal = Decimal("0.046")    # RBI MPC Apr 2026: CPI 4.6% FY26-27
