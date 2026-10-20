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
    LiquidityClass, Loan, LoanType, PayoffRules, PFBalance, TaxRegimeIN, User,
)
from engine.formulas import flat_to_reducing
from engine.layer0 import EmployerMatch
from engine.ordering import Strategy
from api.prepay_schema import PrepayOption

D = Decimal


class _Base(BaseModel):
    model_config = ConfigDict(arbitrary_types_allowed=True)


# ── Input bounds: anything outside is a typing slip or an attack, and they keep the engines' loops
# short (1E+999999 crashed ten endpoints; 500 loans were accepted: api/tests/test_api_fuzz.py).
# Request bodies subclass _In; responses don't, so a large projected figure never fails on the way out.

MAX_AMOUNT = D("1e12")          # ₹1 lakh crore / $1 trillion
MAX_INT = 100_000
MAX_MONTHS = 1200               # the plan horizon is 100 years
MAX_TENURE_MONTHS = 480         # the longest loan the app takes (40 years)
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


def _loan_rate(v: Decimal) -> Decimal:
    """A loan's yearly rate (Audit C12): instant-loan apps and short BNPL
    plans price above 100% a year (often 1% a day, ~365%), so they're
    accepted up to 1,000% a year (10), the same ceiling as EffectiveRate.
    The web asks "that's 120% a year, right?" before sending one."""
    if v < 0:
        raise ValueError("a rate can't be negative")
    if v > MAX_LOAN_RATE:
        raise ValueError(
            f"rates are fractions of 1: send {v / 100:f} for {v:f}%. "
            f"Rates above 1,000% a year are not accepted"
        )
    return v


MAX_LOAN_RATE = D("10")


def _year_month(v: Any) -> Any:
    """'YYYY-MM' (a longer ISO date is cut to its month); blank = None."""
    if v is None or (isinstance(v, str) and not v.strip()):
        return None
    if isinstance(v, date):
        return v.strftime("%Y-%m")
    if not isinstance(v, str):
        raise ValueError("must be a month as YYYY-MM")
    t = v.strip()[:7]
    try:
        y, m = int(t[:4]), int(t[5:7])
    except ValueError:
        raise ValueError("must be a month as YYYY-MM") from None
    if len(t) != 7 or t[4] != "-" or not (1 <= m <= 12) or not (1900 <= y <= 2200):
        raise ValueError("must be a month as YYYY-MM")
    return t


def _months_between(a: str, b: str) -> int:
    """Whole months from 'YYYY-MM' a to b (negative when b is earlier)."""
    return (int(b[:4]) - int(a[:4])) * 12 + int(b[5:7]) - int(a[5:7])


def _add_months(a: str, n: int) -> str:
    k = int(a[:4]) * 12 + int(a[5:7]) - 1 + n
    return f"{k // 12:04d}-{k % 12 + 1:02d}"


def current_month() -> str:
    """This calendar month, 'YYYY-MM', in India time (the app's default
    zone). Tests freeze it by patching this function."""
    from datetime import datetime, timedelta, timezone
    return (datetime.now(timezone.utc) + timedelta(hours=5, minutes=30)).strftime("%Y-%m")


Amount = Annotated[Decimal, AfterValidator(_amount)]
Rate = Annotated[Decimal, AfterValidator(_rate)]
LoanRate = Annotated[Decimal, AfterValidator(_loan_rate)]
SignedRate = Annotated[Decimal, Field(ge=-1, le=1)]
Months = Annotated[int, Field(ge=0, le=MAX_MONTHS)]
Horizon = Annotated[int, Field(ge=1, le=MAX_MONTHS)]
LoanIndex = Annotated[int, Field(ge=0, lt=MAX_LOANS)]
# An effective APR (fees included) can pass 100% on a short BNPL plan.
EffectiveRate = Annotated[Decimal, Field(ge=0, le=10)]
# Live re-test 8 R8-6: a person's own assumptions, bounded (fractions of 1) so an absurd typed
# value never reaches the engine; the web form uses the same bounds (r8-inputs ASSUMPTION_BOUNDS).
TaxRate = Annotated[Decimal, Field(ge=0, le=D("0.6"))]
FeeRate = Annotated[Decimal, Field(ge=0, le=D("0.1"))]


def age_in_months(dob: Optional[str], month: Optional[str] = None) -> Optional[int]:
    """Age in whole calendar months at plan month 1 (this month, `month` =
    "YYYY-MM", default current_month()), from a YYYY-MM or YYYY-MM-DD date
    of birth; the day is ignored (the plan runs by month). None when not
    given or in the future."""
    if not dob:
        return None
    ty, tm = (int(x) for x in (month or current_month()).split("-")[:2])
    y, m = (int(x) for x in dob.split("-")[:2])
    months = (ty - y) * 12 + (tm - m)
    return months if months >= 0 else None


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
    nominal_rate: LoanRate
    rate_type: str = "floating"
    tenure_months_remaining: Months
    scheduled_emi: Amount
    # Both are yearly rates added to the loan's cost (M2: unbounded values
    # turned a 12% loan "not worth prepaying" or broke the maths).
    processing_fee_amortised: FeeRate = D("0")
    insurance_premium_pct: FeeRate = D("0")
    property_use: Optional[str] = None
    min_payment_override: Optional[Amount] = None
    currency: Optional[str] = None
    expected_monthly_spend: Amount = D("0")
    # Card statement / due day (1-28): UI-only, the engine ignores them.
    statement_day: Optional[int] = Field(None, ge=1, le=28)
    due_day: Optional[int] = Field(None, ge=1, le=28)
    # Floating-rate scheduling — only meaningful when rate_type == "floating".
    # See engine/models.py:Loan for semantics. next_reset_month is 1-based
    # against the simulation; the frontend derives it from a calendar
    # next_reset_date before sending.
    rate_reset_frequency_months: Optional[int] = Field(None, ge=1, le=MAX_MONTHS)
    next_reset_month: Optional[int] = Field(None, ge=1, le=MAX_MONTHS)
    rate_drift_annualized: SignedRate = D("0")
    # True-APR restructuring triggers — see engine/models.py:Loan docstring.
    prepayment_penalty_pct: Decimal = Field(D("0"), ge=0, le=D("0.1"))
    # RBI prepayment rule (engine/prepayment_fee.py). Omitted = not given.
    lender_type: Optional[Literal[
        "bank", "commercial_bank", "small_finance_bank", "regional_rural_bank",
        "cooperative_bank", "nbfc", "hfc", "other", "unknown",
    ]] = None
    business_purpose: Optional[bool] = None
    sanction_year: Optional[int] = Field(None, ge=1990, le=2100)
    sanctioned_amount: Optional[Amount] = None
    prepay_lock_in_months: Months = 0
    part_payment_freq_months: Optional[int] = Field(None, ge=1, le=MAX_MONTHS)
    # Lender's minimum part-payment (grill #30); extra below it is set aside.
    min_prepay_amount: Amount = D("0")
    # People loans at a fixed amount of interest a month (web/src/lib/people-loan.ts).
    fixed_monthly_interest: Optional[Amount] = None
    pre_emi_months_remaining: Months = 0
    # Sim month of the first EMI (a loan taken this month: 2). The web
    # derives it from the loan's calendar first EMI month.
    first_payment_month: int = Field(1, ge=1, le=MAX_MONTHS)
    # Quoted rate basis — "flat" (consumer-durable / NBFC quote) or
    # "reducing" (bank quote). Converted to reducing at to_engine().
    rate_basis: str = "reducing"
    # Optional UI-only labelling for credit cards. Engine ignores both.
    card_last_6: Optional[str] = None
    cardholder_name: Optional[str] = None
    # India tax inputs (sprint G2): see engine/models.py:Loan. The web's Tax
    # page sets them; omitted = the whole loan is the user's, no window /
    # pre-construction / rent known, the full ₹2L cap.
    tax_share: Decimal = Field(D("1"), ge=0, le=1)
    tax_deduction_months_left: Optional[int] = Field(None, ge=0, le=MAX_MONTHS)
    pre_construction_interest_annual: Amount = D("0")
    annual_rent: Optional[Amount] = None
    sec24_full_cap: bool = True
    # C10 / C16 / C17 (audit 80): engine/models.py:Loan.
    principal_80c_eligible: bool = True
    mortgage_before_2017_12_16: bool = False
    us_auto_interest_qualified: bool = False
    # US-only (engine/us_loans.py, grill #33/#34). Student loans: "federal" |
    # "private" (blank = treated as federal); forgiveness track "pslf" |
    # "idr" holds extra payments off the loan. Mortgages: monthly PMI / FHA
    # MIP, the home's original value, the insurance kind, FHA months left.
    student_loan_kind: Optional[str] = None
    forgiveness_track: Optional[str] = None
    pmi_monthly: Amount = D("0")
    original_home_value: Optional[Amount] = None
    mortgage_insurance_kind: Optional[str] = None
    pmi_months_remaining: Optional[int] = Field(None, ge=0, le=MAX_MONTHS)
    # ── The contract over time (Audit 80+ Section C; engine/contract.py) ──
    # C1: what a rate rise does ("extend" | "raise_emi" | "mix"; blank = the
    # market default: extend in India, raise_emi in the US) and the most
    # months the loan may have left after an extension (lender's maximum
    # tenure or the borrower's age limit, from today).
    on_rate_rise: Optional[str] = None
    max_tenure_months: Optional[int] = Field(None, ge=1, le=MAX_TENURE_MONTHS)
    # C2: "emi" | "interest_only" | "bullet" (blank: gold with no EMI = bullet, else EMI).
    repayment: Optional[str] = None
    promo_months: Months = 0                        # UX2B-5: plan months at the promo rate,
    rate_after_promo: Optional[Rate] = None         # then this rate
    # C4: the calendar month extra payments are first allowed ('YYYY-MM'); the lock-in
    # runs down from it. Without it a typed `prepay_lock_in_months` counts from
    # `loan_start_month`, else `balance_as_of` (the web stamps it), else today.
    prepay_lock_in_until: Optional[str] = None
    loan_start_month: Optional[str] = None
    balance_as_of: Optional[str] = None
    # C15: a flat-rate loan's original tenure. Its true reducing rate is
    # solved from the original terms, not the months left.
    original_tenure_months: Optional[int] = Field(None, ge=1, le=MAX_TENURE_MONTHS)
    # Round 3: what a LAP / top-up paid for (engine tax_type); "settled" leaves the plan;
    # behind / collections: engine/debt_status.py (overdue_amount blank = one EMI, estimated).
    house_use: Optional[Literal["buy_build", "repair", "other"]] = None
    debt_status: Literal["normal", "behind", "collections", "settled"] = "normal"
    overdue_amount: Optional[Amount] = None
    salary_deducted: bool = False

    @field_validator("prepay_lock_in_until", "loan_start_month", "balance_as_of", mode="before")
    @classmethod
    def _months(cls, v: Any) -> Any:
        return _year_month(v)

    @field_validator("on_rate_rise", "repayment", mode="before")
    @classmethod
    def _contract_enums(cls, v: Any, info) -> Any:
        if v is None or (isinstance(v, str) and not v.strip()):
            return None
        if not isinstance(v, str):
            raise ValueError(f"{info.field_name} must be text")
        t = v.strip().lower().replace("-", "_")
        allowed = {"on_rate_rise": ("extend", "raise_emi", "mix"),
                   "repayment": ("emi", "interest_only", "bullet")}[info.field_name]
        if t not in allowed:
            raise ValueError(f"{info.field_name} must be one of {', '.join(allowed)}")
        return t

    def lock_in_months_left(self, today: str | None = None) -> int:
        """Months from this month during which extra payments are refused
        (Audit C4). Sim month m is calendar month today + (m - 1), so a
        lock-in ending before `until` covers the first (until - today)
        months."""
        today = today or current_month()
        until = self.prepay_lock_in_until
        if until is None and self.prepay_lock_in_months > 0:
            start = self.loan_start_month or self.balance_as_of
            if start is None:
                return self.prepay_lock_in_months      # legacy: from today
            until = _add_months(start, self.prepay_lock_in_months)
        if until is None:
            return 0
        return max(0, min(MAX_MONTHS, _months_between(today, until)))

    def reducing_rate(self) -> tuple[Decimal, Optional[str]]:
        """The reducing-balance rate the engine runs on, and a warning when
        a flat rate had to be converted on a guess (Audit C15).

        A flat rate is converted over the loan's original tenure when it is
        given (the true rate doesn't change as the loan ages). Otherwise it
        is solved from the balance, EMI and months left when those agree
        with a flat quote (a reducing rate between the flat rate and three
        times it). Only failing both is the months left used, with a
        warning to add the original tenure."""
        if self.rate_basis != "flat" or self.nominal_rate <= 0:
            return self.nominal_rate, None
        if self.original_tenure_months:
            return flat_to_reducing(self.nominal_rate, self.original_tenure_months), None
        from engine.contract import implied_reducing_rate
        if self.outstanding > 0 and self.scheduled_emi > 0 and self.tenure_months_remaining > 0:
            r = implied_reducing_rate(self.outstanding, self.scheduled_emi, self.tenure_months_remaining)
            if r is not None and self.nominal_rate <= r <= self.nominal_rate * 3:
                return r, None
        if self.tenure_months_remaining > 0:
            return flat_to_reducing(self.nominal_rate, self.tenure_months_remaining), (
                "This flat rate was converted over the months left, which reads lower than the loan's "
                "true rate as it ages. Add the loan's original tenure for the exact rate.")
        return self.nominal_rate, None

    def contract_warnings(self) -> list[str]:
        """Plain warnings about this loan's terms (Audit C3, C15)."""
        from engine.contract import contract_mismatch
        out = []
        _, flat_note = self.reducing_rate()
        if flat_note:
            out.append(flat_note)
        mismatch = contract_mismatch(self.to_engine())
        if mismatch:
            out.append(mismatch)
        return out

    @field_validator("student_loan_kind", "forgiveness_track", "mortgage_insurance_kind", mode="before")
    @classmethod
    def _us_enums(cls, v: Any, info) -> Any:
        if v is None or (isinstance(v, str) and not v.strip()):
            return None
        if not isinstance(v, str):
            raise ValueError(f"{info.field_name} must be text")
        t = v.strip().lower().replace("-", "_")
        allowed = {
            "student_loan_kind": ("federal", "private"),
            # E7: "none" (not on PSLF/IDR) and "unsure" are answers too;
            # no value at all means never asked (extra held until answered).
            "forgiveness_track": ("pslf", "idr", "none", "unsure"),
            "mortgage_insurance_kind": ("pmi", "fha_mip"),
        }[info.field_name]
        if t not in allowed:
            raise ValueError(f"{info.field_name} must be one of {', '.join(allowed)}")
        return t

    @field_validator("statement_day", "due_day", mode="before")
    @classmethod
    def _day_1_28(cls, v: Any) -> Any:
        # Saved profiles may hold 29-31 from before the 1-28 rule; a month
        # always has a 28th, so clamp instead of failing the whole plan.
        if isinstance(v, int) and 28 < v <= 31:
            return 28
        return v

    @field_validator("currency", mode="before")
    @classmethod
    def _currency(cls, v: Any) -> Any:
        # H4: free text let "usd" or "EUR" fall back to 1:1.
        if v is None or (isinstance(v, str) and not v.strip()):
            return None
        if not isinstance(v, str) or v.strip().upper() not in ("INR", "USD"):
            raise ValueError("Loan currency must be INR or USD")
        return v.strip().upper()

    @field_validator("rate_type", "rate_basis", "property_use", mode="before")
    @classmethod
    def _lower_enum(cls, v: Any, info) -> Any:
        # M2: a typo such as "Floating" silently turned rate resets off.
        if v is None:
            return None if info.field_name == "property_use" else v
        if not isinstance(v, str):
            raise ValueError(f"{info.field_name} must be text")
        t = v.strip().lower().replace("-", "_")
        allowed = {
            "rate_type": ("floating", "fixed"),
            "rate_basis": ("reducing", "flat"),
            "property_use": ("self_occupied", "let_out", ""),
        }[info.field_name]
        if t not in allowed:
            raise ValueError(f"{info.field_name} must be one of {', '.join(a for a in allowed if a)}")
        return (t or None) if info.field_name == "property_use" else t

    def to_engine(self) -> Loan:
        # Convert flat-quoted consumer-durable / NBFC rates to their
        # reducing-balance equivalent so the engine math (which assumes
        # reducing) stays consistent. No-op for the default "reducing"
        # case which covers all bank quotes.
        effective_rate, _ = self.reducing_rate()
        from engine.prepayment_fee import fee_lender_from_bank
        lender = (self.lender_type or None) or fee_lender_from_bank(self.bank)
        return Loan(
            loan_type=self.loan_type, bank=self.bank,
            nominal_rate=effective_rate, rate_type=self.rate_type,
            **({"outstanding": D("0"), "scheduled_emi": D("0"), "tenure_months_remaining": 0} if self.debt_status == "settled" else
               {"outstanding": self.outstanding, "scheduled_emi": self.scheduled_emi, "tenure_months_remaining": self.tenure_months_remaining}),
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
            lender_type=lender,
            business_purpose=self.business_purpose,
            sanction_year=self.sanction_year,
            sanctioned_amount=self.sanctioned_amount,
            prepay_lock_in_months=self.lock_in_months_left(),
            min_prepay_amount=self.min_prepay_amount,
            fixed_monthly_interest=self.fixed_monthly_interest if self.loan_type == "people_loan" else None,
            part_payment_freq_months=self.part_payment_freq_months,
            pre_emi_months_remaining=self.pre_emi_months_remaining,
            first_payment_month=self.first_payment_month,
            rate_basis=self.rate_basis,
            tax_share=self.tax_share,
            tax_deduction_months_left=self.tax_deduction_months_left,
            pre_construction_interest_annual=self.pre_construction_interest_annual,
            annual_rent=self.annual_rent,
            sec24_full_cap=self.sec24_full_cap,
            principal_80c_eligible=self.principal_80c_eligible,
            mortgage_before_2017_12_16=self.mortgage_before_2017_12_16,
            us_auto_interest_qualified=self.us_auto_interest_qualified,
            student_loan_kind=self.student_loan_kind,
            forgiveness_track=self.forgiveness_track,
            pmi_monthly=self.pmi_monthly,
            original_home_value=self.original_home_value,
            mortgage_insurance_kind=self.mortgage_insurance_kind,
            pmi_months_remaining=self.pmi_months_remaining,
            on_rate_rise=self.on_rate_rise,
            max_tenure_months=self.max_tenure_months,
            repayment=self.repayment,
            promo_months=self.promo_months, rate_after_promo=self.rate_after_promo,
            house_use=self.house_use, overdue_amount=self.overdue_amount,
            debt_status=self.debt_status if self.debt_status != "settled" else "normal",
        )


class AssetIn(_In):
    asset_type: str
    purchase_price: Amount
    # Blank when the form was saved without one. The asset can't be ranked
    # for sale (its tax turns on how long it was held), so the engine
    # doesn't see it, but the rest of the request still runs.
    purchase_date: Optional[date] = None
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
    # Selling cost as a share of sale value; None = the engine default (roadmap PR D).
    selling_cost_pct: Optional[Rate] = None
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
            if not t:
                return None
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
            selling_cost_pct=self.selling_cost_pct,
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
    kind: str = Field(..., pattern=r"^(salaried|business_owner|freelance|rental|capital_gains|interest|other)$")
    label: str
    gross_annual: Decimal
    start_date: str
    end_date: Optional[str] = None
    tds_pct: Optional[Decimal] = None
    # Round 2: "business_44ada" | "business_normal" | ... (UI-only) and the
    # kind of capital gain for the salaried advance-tax panel.
    tax_treatment: Optional[str] = None
    cg_kind: Optional[str] = Field(None, pattern=r"^(equity_stcg|equity_ltcg|other)$")


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

class PayoffRulesIn(_In):
    """The user's payoff rules (strategy "rules", roadmap PR E). Loans are
    named by their position in `user.loans`."""
    small_first_below: Optional[Amount] = None
    pinned: list[LoanIndex] = Field(default_factory=list)
    custom_order: list[LoanIndex] = Field(default_factory=list)

    def to_engine(self) -> PayoffRules:
        return PayoffRules(
            small_first_below=self.small_first_below,
            pinned=list(self.pinned), custom_order=list(self.custom_order),
        )


class SeasonalIncomeIn(_In):
    """Round 2 (item 4): take-home for each calendar month, January first,
    for income that varies by season (a shop's festive quarter, a farmer's
    harvest, a tutor's exam months). With it the plan runs month by month
    on this pattern (each year's hike scales it) instead of one flat
    figure. `reserve` (opt-in, default off): in good months hold back what
    the next lean stretch needs instead of prepaying, so a lean month isn't
    borrowed on a card (engine/simulation.py income_lookahead)."""
    pattern: list[Amount] = Field(..., min_length=12, max_length=12)
    reserve: bool = False

    @field_validator("pattern")
    @classmethod
    def _some_income(cls, v):
        if sum(v, D("0")) <= 0:
            raise ValueError("a seasonal pattern needs some income in the year")
        return v


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
    credit_score: Optional[int] = Field(None, ge=300, le=900)
    savings_balance: Amount
    # Per-account cash breakdown (display + cash advisor; engine drops it).
    # `savings_balance` stays authoritative; the web keeps it as their sum.
    cash_accounts: list[CashAccountIn] = Field(default_factory=list)
    # Yearly tax on income outside TDS (rent, FD interest, gains, freelance):
    # the /debts tax-sleeve card for salaried users. Engine drops it.
    extra_income_annual_tax: Optional[Amount] = None
    primary_bank: str
    location_tier: str = "urban"
    # Audit C11: most the user could borrow to cover short months (spare
    # card limit), their currency. Blank = 3 months of take-home pay.
    gap_credit_limit: Optional[Amount] = None
    # Round 2 (founder, item 1): date of birth (YYYY-MM or YYYY-MM-DD) and
    # the age loans should end by. With a date of birth, a tenure-first rate
    # rise never runs a loan past that age; blank retirement age = 60
    # salaried / 70 otherwise (engine/contract.default_retirement_age).
    date_of_birth: Optional[str] = Field(None, pattern=r"^(19|20)\d\d-(0[1-9]|1[0-2])(-(0[1-9]|[12]\d|3[01]))?$")
    retirement_age: Optional[int] = Field(None, ge=40, le=85)
    # Round 2 (item 3): the user's own assumed yearly return after tax on
    # money kept back. Blank = 6.5% India / 4% US (labelled assumption).
    assumed_post_tax_return: Optional[Annotated[Decimal, Field(ge=D("0"), le=D("0.3"))]] = None
    # Round 2 (item 4): cost of sending money home, share of the amount
    # sent. Blank = the published corridor average.
    remittance_cost: Optional[Annotated[Decimal, Field(ge=D("0"), lt=D("0.2"))]] = None
    # Round 2 (item 4): a monthly income pattern (see SeasonalIncomeIn).
    # Read by /simulate only; to_engine() doesn't pass it on.
    seasonal_income: Optional[SeasonalIncomeIn] = None
    other_banks: list[str] = Field(default_factory=list)
    tax_regime: Optional[TaxRegimeIN] = None
    # Old regime: this tax year's s.123 [80C] items other than home-loan
    # principal (EPF, PPF, ELSS, …). None = not asked (C10).
    sec80c_other: Optional[Amount] = None
    pf: Optional[PFBalanceIn] = None
    filing_status: Optional[FilingStatusUS] = None
    state: Optional[str] = None
    state_marginal_rate: TaxRate = D("0")
    itemises: Optional[bool] = None
    efund_balance: Amount = D("0")
    efund_target: Amount = D("0")
    loans: list[LoanIn] = Field(default_factory=list, max_length=MAX_LOANS)
    assets: list[AssetIn] = Field(default_factory=list)
    investment_options: list[InvestmentOptionIn] = Field(default_factory=list)
    annual_hike_rate: Decimal = Field(D("0"), ge=D("-0.5"), le=D("0.5"))
    hike_effective_month: int = Field(default=1, ge=1, le=12)
    # Hike phases [year_from (incl, 1-based), year_to (excl), annual rate]; empty =
    # annual_hike_rate throughout. The engine takes the first matching phase.
    hike_schedule: list[tuple[int, int, Decimal]] = Field(default_factory=list)

    @field_validator("hike_schedule")
    @classmethod
    def _hike_phase_rates_bounded(cls, v):
        # R8-6: each phase's rate has the same bounds as annual_hike_rate.
        for _f, _t, rate in v:
            if rate < D("-0.5") or rate > D("0.5"):
                raise ValueError("a pay-rise phase must be between -50% and 50% a year")
        return v
    business_cagr: Decimal = Field(D("0"), ge=D("-0.5"), le=D("0.5"))
    inflation_rate: Decimal = Field(D("0.046"), ge=D("-0.1"), le=D("0.5"))
    is_nri_us: bool = False
    fx_to_user_currency: Dict[str, Decimal] = Field(default_factory=dict)
    # Annualized FX drift per non-residence currency. Engine compounds
    # monthly: rate_at_m = spot × (1 + drift)^((m-1)/12). Empty / omitted
    # → no drift, FX stays flat at spot. Used by the NRI-US FX-drift toggle.
    fx_drift_annualized: Dict[str, Decimal] = Field(default_factory=dict)
    # Strategy "rules": the user's own payoff order (engine/ordering.apply_rules).
    payoff_rules: Optional[PayoffRulesIn] = None
    # The user's own assumptions (roadmap PR D); omitted = the defaults.
    prepay_hurdle: Optional[Annotated[Decimal, Field(ge=D("0"), le=D("0.2"))]] = None
    asset_returns: Dict[str, Annotated[Decimal, Field(ge=D("-0.5"), le=D("1"))]] = Field(default_factory=dict)
    liquidation_costs: Dict[str, Rate] = Field(default_factory=dict)

    @field_validator("fx_to_user_currency", "fx_drift_annualized", mode="after")
    @classmethod
    def _fx_keys(cls, v: Dict[str, Decimal], info) -> Dict[str, Decimal]:
        out: Dict[str, Decimal] = {}
        for k, val in v.items():
            key = str(k).strip().upper()
            if key not in ("INR", "USD"):
                raise ValueError("Exchange rates are only supported for INR and USD")
            if info.field_name == "fx_drift_annualized" and not (D("-0.99") <= val <= D("1")):
                # H5: below -1 the monthly factor is complex and the API 500'd.
                raise ValueError("FX drift must be between -99% and +100% a year")
            if info.field_name == "fx_to_user_currency" and val < 0:
                raise ValueError("Exchange rates can't be negative")
            out[key] = val
        return out

    @model_validator(mode="after")
    def _fx_for_foreign_loans(self):
        # H4: a foreign loan without a rate was counted 1:1 (USD 5,000 as
        # ₹5,000). Every foreign loan that still owes needs a rate above 0.
        own = "INR" if self.country == Country.IN else "USD"
        for loan in self.loans:
            ccy = loan.currency or own
            if ccy != own and loan.outstanding > 0 and self.fx_to_user_currency.get(ccy, D("0")) <= 0:
                raise ValueError(f"Save an exchange rate for your {ccy} loan (1 {ccy} in {own})")
        return self

    # Old-regime / itemized deductions. Engine drops these — used by the
    # frontend to derive a more accurate marginal_rate display + tax
    # breakdown. See `DeductionsIn` for field semantics.
    deductions: Optional["DeductionsIn"] = None
    income_streams: list[IncomeStreamIn] = Field(default_factory=list)
    # Sprint G2 (#20): True once the user said the tax rate the plan uses
    # (estimated from take-home) is right. UI-only; the engine drops it.
    tax_rate_confirmed: Optional[bool] = None

    def _itemised(self) -> tuple[bool, Decimal]:
        """US only: does this person itemise, and what share of their
        mortgage interest lowers their tax? Round 3 (UX walkthrough 2 #25):
        only someone who said they itemise gets a break (Setup and /tax ask;
        not answered = the standard deduction, no break). For them only the
        part above the standard deduction saves anything: a $350k mortgage at
        6.75% ($23,625 of interest, $16,100 standard) saves tax on $7,525, a
        share of 0.32, from the deductions entered, else the US home loans.
        With nothing showing above the standard deduction, their word stands."""
        if self.country != Country.US or self.itemises is not True:
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
        if mortgage <= 0:
            return True, D("0")
        return True, (min(mortgage, above) / mortgage) if above > 0 else D("1")

    def salary_deducted_emis(self) -> Decimal:
        """#21: take-home is already net of EMIs cut from pay; the plan takes every EMI off it, so add them back."""
        ccy = "INR" if self.country == Country.IN else "USD"
        return sum((l.scheduled_emi for l in self.loans if l.salary_deducted and l.debt_status != "settled"
                    and (l.currency or ccy).upper() == ccy), D("0"))

    def _engine_loans(self) -> list[Loan]:
        """A collections loan the user pinned or ordered is paid like any other (their choice wins)."""
        mine = set(self.payoff_rules.pinned) | set(self.payoff_rules.custom_order) if self.payoff_rules else set()
        loans = [l.to_engine() for l in self.loans]
        for i in mine & set(range(len(loans))):
            loans[i].extra_ok = True
        return loans

    def to_engine(self) -> User:
        return User(
            country=self.country, income_type=self.income_type,
            annual_income=self.annual_income, monthly_income=self.monthly_income + self.salary_deducted_emis(),
            fixed_expenses=self.fixed_expenses,
            variable_expenses=self.variable_expenses,
            annual_gross_salary=self.annual_gross_salary,
            annual_business_income=self.annual_business_income,
            credit_score=self.credit_score,
            savings_balance=self.savings_balance,
            primary_bank=self.primary_bank, location_tier=self.location_tier,
            other_banks=list(self.other_banks),
            tax_regime=self.tax_regime,
            sec80c_other=self.sec80c_other,
            pf=self.pf.to_engine() if self.pf else None,
            filing_status=self.filing_status, state=self.state,
            state_marginal_rate=self.state_marginal_rate,
            itemises=self._itemised()[0],
            itemised_share=self._itemised()[1],
            efund_balance=self.efund_balance, efund_target=self.efund_target,
            loans=self._engine_loans(),
            assets=[a.to_engine() for a in self.assets if a.purchase_date is not None],
            investment_options=[o.to_engine() for o in self.investment_options],
            annual_hike_rate=self.annual_hike_rate,
            hike_effective_month=self.hike_effective_month,
            hike_schedule=list(self.hike_schedule),
            business_cagr=self.business_cagr,
            inflation_rate=self.inflation_rate,
            is_nri_us=self.is_nri_us,
            fx_to_user_currency=dict(self.fx_to_user_currency),
            fx_drift_annualized=dict(self.fx_drift_annualized),
            payoff_rules=self.payoff_rules.to_engine() if self.payoff_rules else None,
            prepay_hurdle=self.prepay_hurdle,
            asset_returns=dict(self.asset_returns),
            liquidation_costs=dict(self.liquidation_costs),
            gap_credit_limit=self.gap_credit_limit,
            age_months=age_in_months(self.date_of_birth),
            retirement_age=self.retirement_age,
            assumed_post_tax_return=self.assumed_post_tax_return,
            remittance_cost=self.remittance_cost,
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


class PaidOffIn(_In):  # owed-fix: money gone out this month the opening balance still holds (cards), loan's currency
    loan_index: Annotated[int, Field(ge=0, le=200)]
    amount: Amount


class SimulateRequest(_In):
    user: UserIn
    strategy: Strategy = Strategy.AVALANCHE
    # UX fix 4: loans whose EMI for this month is already paid (owed_today).
    paid_emi_this_month: list[Annotated[int, Field(ge=0, le=200)]] = Field(default_factory=list, max_length=200)
    paid_off_this_month: list[PaidOffIn] = Field(default_factory=list, max_length=200)
    horizon_months: Horizon = 360
    matched_contribution: Amount = D("0")
    marginal_rate: Optional[TaxRate] = None
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
    # The most the user wants to put toward debts each month (EMIs,
    # minimums and extra, in their own currency). Omitted: all spare cash.
    debt_budget: Optional[Amount] = None
    # An open preempting goal (a medical bill, a wedding) takes the whole
    # surplus_allocation (100% to goal_slice) for its window. Default False.
    ef_preempted: bool = False
    # Per-goal input: serial-fill each month, returned in
    # surplus_allocation.goal_contributions. Empty: no active goals.
    goals: list[GoalIn] = Field(default_factory=list)
    # Grill #38: a short month is paid from the emergency fund, then
    # borrowed at a card rate and repaid first (engine/gap_debt.py). False
    # keeps the old "the gap is found somewhere, free" assumption.
    gap_as_debt: bool = True
    # Audit 80+ A4: the share of the extra the user chose to keep once every
    # loan left costs under 10% a year (engine/prepay_invest.py). Omitted:
    # the plan prepays everything, as before. Never set by RightDue.
    low_rate_invest_share: Optional[Decimal] = Field(default=None, ge=D("0"), le=D("1"))


class TrajectoryPoint(_Base):
    month: int
    balance: Decimal
    interest_paid: Decimal
    invested: Decimal
    # Per-loan total payment this month, keyed by the loan's 0-based index in
    # the request's `user.loans`. Drives the period-aware "pay ₹X to {bank}"
    # rows in the Plan schedule. Empty after all loans clear.
    payments_by_loan_index: dict[int, Decimal] = Field(default_factory=dict)
    # Balance per loan currency ("INR", "USD"): one line each on the chart,
    # never ₹ + $ summed. Single-currency users get one entry (= `balance`).
    balances_by_currency: dict[str, Decimal] = Field(default_factory=dict)
    # Per-loan outstanding by 0-based index (cleared loans stay at 0): the
    # per-loan chart on /plan.
    balances_by_loan_index: dict[int, Decimal] = Field(default_factory=dict)
    # Surplus before goals / EF / debt took their slices: achievability sums
    # this series (inflation, hikes, events) rather than a static figure.
    available_surplus: Decimal = Field(default=D("0"))
    # All payments this month and the part above each loan's minimum, both
    # in the user's currency (per-loan payments are in each loan's own).
    total_paid: Decimal = Field(default=D("0"))
    extra_paid: Decimal = Field(default=D("0"))
    # Income short of costs plus minimum payments this month (0 when covered).
    shortfall: Decimal = Field(default=D("0"))
    # Gap borrowing (grill #38), user's currency: owed at the month's end,
    # this month's interest on it, borrowed and repaid this month, and the
    # part of the gap the emergency fund covered.
    gap_debt: Decimal = Field(default=D("0"))
    gap_interest: Decimal = Field(default=D("0"))
    gap_borrowed: Decimal = Field(default=D("0"))
    gap_repaid: Decimal = Field(default=D("0"))
    gap_from_savings: Decimal = Field(default=D("0"))
    # Audit C5: extra saved for a loan still in its prepayment lock-in (the
    # running pot at the month's end), shown as "saved for the lock-in to
    # end", never as invested. Audit C11: the part of this month's shortfall
    # that couldn't be borrowed (past the gap limit).
    held_for_lock_in: Decimal = Field(default=D("0"))
    unfunded_shortfall: Decimal = Field(default=D("0"))
    # Founder 17 Oct 2026 (engine/debt_status.py), by loan position: overdue paid on a
    # behind loan (loan currency), and each collections loan's settlement pot (user currency).
    catch_up_by_loan_index: dict[int, Decimal] = Field(default_factory=dict)
    settlement_pot_by_loan_index: dict[int, Decimal] = Field(default_factory=dict)
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
    # Funding rule (roadmap PR F): "schedule" (run-rate to the date, the
    # default here so older clients are unchanged), "fixed" (funding_amount
    # a month), "surplus_pct" (funding_pct of spare cash, 0–1) or
    # "after_debt" (after the loan at after_loan_index clears; None = after
    # every high-interest loan clears: debt first).
    funding_rule: Literal["schedule", "fixed", "surplus_pct", "after_debt"] = "schedule"
    funding_amount: Optional[Amount] = None
    funding_pct: Optional[Rate] = None
    after_loan_index: Optional[Annotated[int, Field(ge=0, le=99)]] = None
    # Programmable diversion (audit 80+, engine/goals.py): "until" a 0-based
    # sim month, a monthly cap, and a floor on the month's spare cash below
    # which the goal pauses. With "after_debt", funding_amount or
    # funding_pct sets what it takes once the debt clears.
    funding_end_month_index: Optional[Months] = None
    funding_cap: Optional[Amount] = None
    pause_below: Optional[Amount] = None

    @model_validator(mode="after")
    def _validate_funding_rule(self) -> "GoalIn":
        if self.funding_rule == "fixed" and (self.funding_amount is None or self.funding_amount <= 0):
            raise ValueError("funding_amount: a fixed monthly amount above zero is needed for the 'fixed' rule")
        if self.funding_rule == "surplus_pct" and (self.funding_pct is None or self.funding_pct <= 0 or self.funding_pct > 1):
            raise ValueError("funding_pct: a share of spare cash between 0 and 1 is needed for the 'surplus_pct' rule")
        if self.funding_pct is not None and not (0 < self.funding_pct <= 1):
            raise ValueError("funding_pct: a share of spare cash between 0 and 1")
        if self.funding_end_month_index is not None and self.funding_start_month_index is not None \
                and self.funding_end_month_index <= self.funding_start_month_index:
            raise ValueError("funding_end_month_index: the goal must stop after it starts")
        return self

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


class GoalTradeoffOut(_Base):
    """Roadmap PR F: what funding one goal now, before high-interest debt,
    costs against funding it debt-first."""
    goal_id: str
    has_high_apr_debt: bool
    # Interest (and fees) paid with the goal funded now, minus debt first. ≥ 0 normally.
    extra_interest: Decimal
    # Months later the debts clear when the goal is funded now (may be 0).
    debt_free_later_months: int
    # Debt first: does the goal still reach its target by its date?
    debt_first_reaches_target: bool
    debt_first_fill_rate: Decimal
    funded_now_fill_rate: Decimal


class GoalTradeoffResponse(_Base):
    tradeoffs: list[GoalTradeoffOut]


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
    # True when the target month sits beyond the horizon (sim stopped at
    # debt_free_month), so the UI says "past your debt-free month" rather
    # than "not reached". Always False when target_reached is True.
    target_past_horizon: bool = False
    # True when saved_at_target ≥ required; can be True with target_reached
    # False (sim stopped early but saving already covers required).
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


class GoalTradeoffRequest(SimulateRequest):
    """A /simulate request plus which goals to price (default: all)."""
    goal_ids: list[str] = Field(default_factory=list, max_length=50)


class RateRiseOptionOut(_Base):
    mode: str                  # "extend" | "raise_emi" | "mix"
    emi: Decimal
    months_left: int
    total_interest: Decimal
    emi_change: Decimal
    months_change: int
    capped: bool = False       # the lender's maximum tenure bound


class RateRiseEventOut(_Base):
    """Audit C1 / A13: one floating-rate rise in the plan. `applied` is what
    the plan did (tenure-first for an Indian loan unless the loan says
    otherwise); `options` both outcomes; `recommended` the most valuable
    step ("extend" | "raise_emi" | "keep_emi_and_prepay") and why."""
    month: int
    loan_index: int
    old_rate: Decimal
    new_rate: Decimal
    old_emi: Decimal
    months_left_before: int
    applied: str
    options: list[RateRiseOptionOut]
    extra_interest_if_extended: Decimal
    recommended: str
    reason: str
    source_url: str = "https://www.rbi.org.in/Scripts/NotificationUser.aspx?Id=12529"


class MaturityOut(_Base):
    """Audit C2/C3: a bullet / interest-only loan's maturity, or a material
    balloon in an EMI loan's last month. `short`: the month couldn't fund it
    (renew or repay)."""
    loan_index: int
    month: int
    kind: str
    amount_due: Decimal
    short: bool


class LoanWarningOut(_Base):
    loan_index: int
    message: str


class NonAmortisingOut(_Base):
    # Live re-test NEW-3: an EMI loan whose EMI is at or below its monthly
    # interest, so it never clears. The plan is not run on it.
    loan_index: int
    monthly_interest: Decimal
    scheduled_emi: Decimal


class GapClosedOut(_Base):
    # The plan with spending cut by this month's shortfall (live test #16).
    cut: Decimal
    debt_free_month: Optional[int]
    total_interest_paid: Decimal


class PmiEventOut(_Base):
    loan_index: int
    last_paid_month: int
    kind: str                                # "pmi" | "fha_mip"
    note: str


class SeasonalRunOut(_Base):
    debt_free_month: Optional[int]
    total_interest_paid: Decimal
    total_gap_interest: Decimal
    infeasible_from_month: Optional[int] = None


class SeasonalOut(_Base):
    """Round 2 (item 4): the plan ran on the user's monthly pattern. Both
    versions are returned so the page can say honestly what holding a
    reserve costs (or saves) in interest against not holding one."""
    applied: bool
    reserve_on: bool
    # Why the pattern wasn't used (e.g. a salary change is planned), when not applied.
    skipped_reason: Optional[str] = None
    # Calendar months (1-12) whose take-home is below the year's average.
    lean_months: list[int] = Field(default_factory=list)
    with_reserve: Optional[SeasonalRunOut] = None
    without_reserve: Optional[SeasonalRunOut] = None
    # with_reserve − without_reserve total interest (can be above 0: the
    # reserve can cost a little more interest in exchange for not
    # borrowing in lean months).
    reserve_interest_difference: Optional[Decimal] = None
    # The most the reserve held back at once (user currency).
    peak_reserve: Optional[Decimal] = None


class SimulateResponse(_Base):
    # 1 = this month. 0 = nothing is owed now (no loans, or all at 0);
    # None = not cleared within the horizon.
    debt_free_month: Optional[int]
    # UX fix 4: what you owe today (engine/owed_today), and the plan's opening balance.
    owed_today: Optional[Decimal] = None
    owed_start_of_month: Optional[Decimal] = None
    owed_today_interest_in_paid: Optional[Decimal] = None
    owed_today_paid_off: Optional[Decimal] = None
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
    # Fee-aware payoff order (roadmap PR K). Set when an Avalanche plan had
    # a loan with a prepayment fee: how the order was searched ("exact" |
    # "local"), and, when a fee changed the order from ranking by rate
    # alone, the plain-words "why this loan first" line.
    payoff_order_method: Optional[str] = None
    payoff_order_note: Optional[str] = None
    # Gap borrowing (grill #38): the yearly rate before GST, whether it is
    # the user's own card ("your_card") or the country default ("default"),
    # where the default comes from, and its interest over the plan (already
    # inside total_interest_paid).
    gap_rate: Optional[Decimal] = None
    gap_rate_basis: Optional[str] = None
    gap_rate_source: Optional[str] = None
    total_gap_interest: Decimal = D("0")
    # Live test #16: when this month is short, the same plan with the gap
    # closed (spending cut by this month's shortfall), so the headline can
    # say "<date> if the ₹X gap closes" beside the as-things-stand date.
    gap_closed: Optional[GapClosedOut] = None
    # US mortgage insurance (grill #34): one row per loan whose PMI / FHA
    # MIP ends inside the plan, with the sim month it was last paid.
    pmi_events: list[PmiEventOut] = Field(default_factory=list)
    # Live re-test NEW-2/NEW-3: True when the debt is not cleared within the
    # horizon. Totals and peaks then describe a debt that grows without
    # limit and must not be shown as a normal result.
    never_clears: bool = False
    # Loans whose EMI doesn't cover their interest. When non-empty the plan
    # was NOT run (no 1,200-month schedule): trajectory is empty.
    non_amortising: list[NonAmortisingOut] = Field(default_factory=list)
    # Round 2 (item 4): set when the user gave a seasonal income pattern.
    seasonal: Optional[SeasonalOut] = None
    # Live re-test 2 NEW-2: when the plan never clears, the trajectory stops
    # at the 30-year horizon, or earlier at the first month what's owed
    # (loans + gap borrowing) passes 100x what's owed at the start. This is
    # the month it stops at (None when the trajectory is the whole run), and
    # whether it stopped because the debt grows without limit.
    trajectory_cut_month: Optional[int] = None
    grows_without_limit: bool = False
    # Audit C1: rate rises with both outcomes and the recommended step.
    rate_rise_events: list[RateRiseEventOut] = Field(default_factory=list)
    # Audit C2/C3: maturities and balloons.
    maturities: list[MaturityOut] = Field(default_factory=list)
    # Audit C3/C15: loans whose terms don't agree, in plain words.
    loan_warnings: list[LoanWarningOut] = Field(default_factory=list)
    # Audit C11: gap borrowing's limit (user currency; `gap_limit_assumed`
    # when it's the 3-months-of-pay default), the first month a shortfall
    # couldn't be borrowed (the plan isn't fundable as it stands from then),
    # and what couldn't be borrowed in total. Lead with the monthly gap
    # (`shortfall`), not compounded totals.
    gap_limit: Optional[Decimal] = None
    gap_limit_assumed: bool = False
    infeasible_from_month: Optional[int] = None
    unfunded_shortfall: Decimal = D("0")


class BaselineRequest(_In):
    user: UserIn
    horizon_months: Horizon = 360
    simple_mode: bool = False
    # Planned rate resets, so the minimums-only comparison sees the same
    # rates as the plan it is compared with.
    lifecycle_events: list[LifecycleEventIn] = Field(default_factory=list, max_length=500)
    gap_as_debt: bool = True


class CompareRequest(_In):
    """For sensitivity comparisons — caller supplies the two scenarios.

    The plan fields below are the same as SimulateRequest's, so both runs
    are the plan /plan shows (the sliders used to run a plainer one and
    their "before" date could differ from the plan's)."""
    user: UserIn
    horizon_months: Horizon = 360
    marginal_rate: Optional[TaxRate] = None
    strategy: Strategy = Strategy.AVALANCHE
    simulation_start_month: int = Field(default=1, ge=1, le=12)
    matched_contribution: Amount = D("0")
    simple_mode: bool = False
    reinvest_events: list[ReinvestEvent] = Field(default_factory=list)
    inflate_expenses: bool = False
    lifecycle_events: list[LifecycleEventIn] = Field(default_factory=list)
    ef_top_up_rate: Optional[Decimal] = Field(default=None, ge=D("0"), le=D("1"))
    goals: list[GoalIn] = Field(default_factory=list)
    debt_budget: Optional[Amount] = None
    low_rate_invest_share: Optional[Decimal] = Field(default=None, ge=D("0"), le=D("1"))
    # what-if knobs
    surplus_delta: Optional[Decimal] = None
    spending_cut: bool = False  # a saved expense change, rather than an increase in take-home pay
    surplus_delta_start_month: int = Field(1, ge=1, le=MAX_MONTHS)
    income_shock_months: Optional[Months] = None
    rate_shock_delta: Optional[SignedRate] = None
    rate_shock_floating_only: bool = True
    alt_strategy: Optional[Strategy] = None
    lump_sum_amount: Optional[Amount] = None
    lump_sum_target_loan_index: Optional[LoanIndex] = None
    lump_sum_mode: Optional[Literal["reduce_tenure", "reduce_emi"]] = None  # UX2 #20; None = not answered: EMI kept
    # Live test #26: one loan re-amortised over this many more months.
    tenure_extension_loan_index: Optional[LoanIndex] = None
    tenure_extension_months: Optional[Annotated[int, Field(ge=1, le=MAX_MONTHS)]] = None
    gap_as_debt: bool = True
    # Live test L#26: also return the scenario's trajectory, so the Plan chart and table can show the what-if.
    include_trajectory: bool = False

    @model_validator(mode="after")
    def _valid_spending_cut(self) -> "CompareRequest":
        if self.spending_cut:
            limit = self.user.variable_expenses if self.user.variable_expenses > 0 else self.user.fixed_expenses
            if self.surplus_delta is None or not (D("0") <= self.surplus_delta <= limit):
                raise ValueError("spending_cut requires surplus_delta between zero and the current spending bucket")
        return self


class CompareResponse(_Base):
    baseline_debt_free_month: Optional[int]
    scenario_debt_free_month: Optional[int]
    months_pulled_forward: Decimal
    interest_saved: Decimal
    extra_invested: Decimal
    # Total interest on each side, for a before/after picture.
    baseline_total_interest: Optional[Decimal] = None
    scenario_total_interest: Optional[Decimal] = None
    # This month's cash gap on each side (0 when covered), so a what-if that closes it can say so (#26).
    baseline_shortfall: Optional[Decimal] = None
    scenario_shortfall: Optional[Decimal] = None
    # Tenure what-if only: the loan's EMI and remaining months before and after.
    tenure_old_emi: Optional[Decimal] = None
    tenure_new_emi: Optional[Decimal] = None
    tenure_old_months: Optional[int] = None
    tenure_new_months: Optional[int] = None
    prepay_options: Optional[list[PrepayOption]] = None  # UX2 #20: the loan alone under each answer
    prepay_mode_used: Optional[str] = None
    # NEW-2: a side never clears within the horizon: interest_saved compares unbounded totals, never shown.
    baseline_never_clears: bool = False
    scenario_never_clears: bool = False
    # L#26 scenario trajectory (include_trajectory), bounded like /simulate's (NEW-2); C11 first unfundable month.
    scenario_trajectory: Optional[list[TrajectoryPoint]] = None
    scenario_trajectory_cut_month: Optional[int] = None
    scenario_grows_without_limit: bool = False
    scenario_infeasible_from_month: Optional[int] = None


# ── Decision modules ─────────────────────────────────────────────────────────────

class WindfallRequest(_In):
    amount: Amount
    user: UserIn
    marginal_rate: Optional[TaxRate] = None
    strategy: Strategy = Strategy.AVALANCHE
    # UX fix 3: the plan's own gap (month 1, else the capped month's) and its first month.
    monthly_gap: Optional[Amount] = None
    short_from_label: Optional[str] = Field(default=None, max_length=20)


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
    # What interest_avoided assumes ("until the card is cleared, …" / "over the loan's remaining life, …").
    interest_basis: str = ""
    # The loan's prepayment fee on `amount` (taken out of it) and the interest
    # avoided less that fee.
    fee: Decimal = D("0")
    net_benefit: Decimal = D("0")
    # Loans passed over because their terms bar an extra payment now.
    blocked: list[str] = []
    catch_up: bool = False   # a behind loan's overdue, paid first (engine/debt_status.py)


class NewDebtRequest(_In):
    list_price: Amount
    cash_price_elsewhere: Amount
    # ≥3 months (a 1-month "loan" is a bill); same 40-year ceiling as the
    # app and engine (R3-2), so 600 months is a field error.
    emi_offer_months: int = Field(..., ge=3, le=MAX_TENURE_MONTHS)
    emi_offer_monthly_payment: Amount
    processing_fee: Amount = D("0")
    user_savings_after_efund: Amount = D("0")
    country: Country = Country.IN           # currency in the wording
    # Income − costs − payments already owed, per month (negative when
    # short). Sent from the profile; an EMI above it isn't "take".
    monthly_room: Optional[Decimal] = Field(None, ge=D("-1e12"), le=D("1e12"))
    # A card EMI (India: GST on its interest) rather than a bank loan.
    card_emi: bool = False
    # What savings earn a year after tax; paying cash wins above it.
    savings_return: Optional[Decimal] = Field(None, ge=D("0"), le=D("1"))
    # The user's costliest debt and its yearly cost, after tax.
    dearest_debt_name: Optional[str] = Field(None, max_length=80)
    dearest_debt_rate: Optional[Decimal] = Field(None, ge=D("0"), le=D("10"))
    # The lowest advertised rate for a loan like this one.
    cheaper_bank: Optional[str] = Field(None, max_length=80)
    cheaper_rate: Optional[Decimal] = Field(None, ge=D("0"), le=D("1"))
    # A month, for the lenders' ceiling on loan payments.
    take_home: Optional[Decimal] = Field(None, ge=D("0"), le=D("1e12"))
    current_payments: Optional[Decimal] = Field(None, ge=D("0"), le=D("1e12"))


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
    gst: Decimal = D("0")


class QuickRecomputeRequest(_In):
    user: UserIn
    extra_payment: Amount
    target_loan_index: LoanIndex = 0
    strategy: Strategy = Strategy.AVALANCHE
    horizon_months: Horizon = 360
    marginal_rate: Optional[TaxRate] = None


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
    marginal_rate: Optional[TaxRate] = None
    # Whose tax rules apply to the sale. A US seller pays federal capital-
    # gains tax (with the §121 main-home exclusion when `asset.
    # us_section_121_eligible`), NIIT and state tax, not India's LTCG.
    country: Country = Country.IN
    filing_status: Optional[FilingStatusUS] = None
    state_marginal_rate: Optional[TaxRate] = None
    # An NRI selling an Indian asset: Indian rules, but no 20%-with-
    # indexation choice on pre-23-Jul-2024 property (residents only).
    seller_resident: bool = True

    @model_validator(mode="after")
    def _needs_purchase_date(self):
        # The tax on a sale turns on how long the asset was held. An empty
        # date reads as None and used to crash the engine (500).
        if self.asset.purchase_date is None:
            raise ValueError("asset.purchase_date: needed to work out the tax on the sale")
        return self


class AssetLiquidationResponse(_Base):
    net_proceeds: Decimal
    ltcg_tax: Decimal
    # How the tax was worked out, for the page to show next to the figure:
    # the rules used, any exclusion and what the user should check.
    tax_notes: list[str] = []
    net_benefit: Decimal
    asset_real_return_net: Decimal
    surplus: Optional[Decimal] = None              # net_proceeds − debt_balance
    wealth_hold: Optional[Decimal] = None
    wealth_sell: Optional[Decimal] = None
    wealth_edge: Optional[Decimal] = None
    # "amortising": the loan is paid on schedule on both paths;
    # "debt_compounds": no payment given, so the hold path lets it grow.
    wealth_basis: Optional[str] = None
    horizon_years: Optional[Decimal] = None
    # Audit 80 W10: figures only. The sell/keep verdict and its pass/fail
    # tests are gone (a calculator, not advice); the summary never chooses.
    rationale: str
    debt_cleared: Decimal = D("0")
    yearly_interest_on_cleared_debt: Decimal = D("0")
    # Property bought before 23 Jul 2024 by a resident: both computations.
    tax_options: list[dict] = []


# ── Layer 0 — employer match ─────────────────────────────────────────────────────────────

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
    marginal_rate: Optional[TaxRate] = None
    # The same inputs as /simulate: compare actual repayment schedules,
    # including the user's debt budget, goals and emergency-fund share.
    plan: Optional[SimulateRequest] = None
    # Each loan's balance at the end of months 1, 2, … under the user's
    # plan (from /simulate's balances_by_loan_index). When given, savings
    # are worked out on these instead of today's balance held for a year,
    # and a move the plan makes pointless is held back.
    plan_balances: Optional[dict[LoanIndex, list[Amount]]] = Field(None, max_length=MAX_LOANS)

    @model_validator(mode="after")
    def _matching_plan(self) -> "RestructuringRequest":
        if self.plan is not None:
            if self.plan.user != self.user:
                raise ValueError("plan.user must match user")
            if self.marginal_rate is not None and self.plan.marginal_rate != self.marginal_rate:
                raise ValueError("plan.marginal_rate must match marginal_rate")
        return self

    @field_validator("plan_balances")
    @classmethod
    def _plan_paths_bounded(cls, v):
        if v is not None and any(len(path) > 600 for path in v.values()):
            raise ValueError("plan_balances: at most 600 months per loan")
        return v


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
    # "best" | "higher" | "unknown": the user's credit score against what
    # the lender keeps its best rate for (`score_needed`).
    credit_fit: str = "unknown"
    score_needed: Optional[int] = None
    # "plan" when the saving uses the plan's balances, else "today".
    saving_basis: str = "today"
    plan_clears_in_months: Optional[int] = None


class RestructuringHeldBackOut(_Base):
    kind: str
    affected_loan_indices: list[int]
    target_bank: Optional[str] = None
    reason: str                              # "credit_score" | "plan_clears" | "costs_more" | "federal_protections"
    note: str


class RestructuringResponse(_Base):
    opportunities: list[RestructuringOpportunityOut]
    total_annual_saving: Decimal
    held_back: list[RestructuringHeldBackOut] = Field(default_factory=list)


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
    marginal_rate: TaxRate = D("0.30")
    high_rate_threshold: Rate = D("0.20")
    horizon_years: Decimal = Field(D("5"), gt=0, le=100)
    surplus_reinvestment_yield: SignedRate = D("0.07")
    pre_filter_margin: Rate = D("0.01")


class LiquidationRankingsResponse(_Base):
    recommendations: list[LiquidationRecommendationOut]
    considered_but_skipped: list[LiquidationRecommendationOut]


class RangeScenarioOut(_Base):
    id: str
    label: str
    why: str
    debt_free_month: Optional[int] = None
    shift_months: Optional[int] = None


class RangeResponse(_Base):
    """Grill #24 (sprint G4): exact debt-free month plus earliest/latest.
    `None` months = not paid off inside the horizon (open_ended)."""
    exact: Optional[int] = None
    earliest: Optional[int] = None
    latest: Optional[int] = None
    scenarios: list[RangeScenarioOut]
    has_floating: bool
    open_ended: bool
    rate_band: Decimal
    income_months: int
