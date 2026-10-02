"""GET /api/fx-rate · POST /api/cross-border-decision.

FX rates are fetched live: frankfurter (ECB reference rates, published each
working day), else open.er-api.com (updated daily). Both are free and need
no key; nothing about the user is sent. A good quote is kept for 15
minutes so a page that asks twice gets the same number.
Manual override is always honoured — caller can pass `manual_rate` to bypass.
"""
import time
from decimal import Decimal
from typing import Optional

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import ConfigDict, Field

from engine.cross_border import (
    CrossBorderInputs, evaluate_cross_border, historical_drift_default,
)
from api.schemas import MAX_MONTHS, Amount, Rate, SignedRate, _Base, _In

D = Decimal
router = APIRouter(tags=["fx"])

# Frankfurter aliases — only currency codes their API accepts.
_FRANKFURTER_SUPPORTED = {
    "AUD", "BGN", "BRL", "CAD", "CHF", "CNY", "CZK", "DKK", "EUR", "GBP",
    "HKD", "HUF", "IDR", "ILS", "INR", "ISK", "JPY", "KRW", "MXN", "MYR",
    "NOK", "NZD", "PHP", "PLN", "RON", "SEK", "SGD", "THB", "TRY", "USD", "ZAR",
}


class FxRateResponse(_Base):
    base: str
    quote: str
    rate: Decimal
    source: str             # "frankfurter" | "open-er-api" | "parity" (same currency) | "fallback"
    as_of: Optional[str]    # YYYY-MM-DD if from upstream


class CrossBorderRequest(_In):
    model_config = ConfigDict(arbitrary_types_allowed=True)
    loan_balance: Amount
    loan_nominal_rate: Rate
    loan_tenure_months: int = Field(..., ge=1, le=MAX_MONTHS)
    loan_currency: str = Field(..., max_length=3)    # e.g. "INR"
    user_currency: str = Field(..., max_length=3)    # e.g. "USD"
    user_savings_yield: SignedRate
    user_marginal_tax: Rate = D("0")
    # user_currency per 1 loan_currency; 0 or negative made every EMI 0 or < 0.
    manual_fx_rate: Optional[Decimal] = Field(None, gt=0, le=D("100000"))
    # overrides historical default; ±50%/yr is already a currency crisis.
    manual_fx_drift_annual: Optional[Decimal] = Field(None, ge=D("-0.5"), le=D("0.5"))
    inflation_user_country: Decimal = Field(D("0.025"), ge=D("-0.1"), le=1)


class CrossBorderResponse(_Base):
    fx_rate_used: Decimal
    fx_drift_used: Decimal
    effective_loan_cost_in_user_currency: Decimal
    user_post_tax_yield: Decimal
    spread: Decimal
    verdict: str
    rationale: str
    loan_emi_user_currency: Decimal
    loan_emi_user_currency_y5: Decimal


# (base, quote) → (fetched at, rate, source, as_of)
_FX_CACHE: dict[tuple[str, str], tuple[float, Decimal, str, Optional[str]]] = {}
FX_CACHE_SECONDS = 15 * 60


async def _from_frankfurter(c: httpx.AsyncClient, base: str, quote: str) -> tuple[Decimal, Optional[str]]:
    r = await c.get(f"https://api.frankfurter.dev/v1/latest?base={base}&symbols={quote}")
    r.raise_for_status()
    data = r.json()
    return D(str(data["rates"][quote])), data.get("date")


async def _from_open_er(c: httpx.AsyncClient, base: str, quote: str) -> tuple[Decimal, Optional[str]]:
    r = await c.get(f"https://open.er-api.com/v6/latest/{base}")
    r.raise_for_status()
    data = r.json()
    if data.get("result") != "success":
        raise ValueError("open.er-api.com did not return a rate")
    # "time_last_update_unix" → the day the rate is for.
    as_of = None
    if isinstance(data.get("time_last_update_unix"), int):
        as_of = time.strftime("%Y-%m-%d", time.gmtime(data["time_last_update_unix"]))
    return D(str(data["rates"][quote])), as_of


async def _fetch_fx(base: str, quote: str) -> tuple[Decimal, str, Optional[str]]:
    """Returns (rate, source, as_of). Falls back to 1.0 if no provider answers."""
    # Same currency: 1, with nothing to fetch. It used to go to the provider,
    # which has no INR/INR quote, so a rupee loan checked from rupees
    # failed with a 502.
    if base == quote:
        return D("1"), "parity", None
    if not (len(base) == 3 and base.isalpha() and len(quote) == 3 and quote.isalpha()):
        return D("1"), "fallback", None
    hit = _FX_CACHE.get((base, quote))
    if hit and time.monotonic() - hit[0] < FX_CACHE_SECONDS:
        return hit[1], hit[2], hit[3]
    providers = []
    if base in _FRANKFURTER_SUPPORTED and quote in _FRANKFURTER_SUPPORTED:
        providers.append(("frankfurter", _from_frankfurter))
    providers.append(("open-er-api", _from_open_er))
    async with httpx.AsyncClient(timeout=4.0) as c:
        for source, fetch in providers:
            try:
                rate, as_of = await fetch(c, base, quote)
            except (httpx.HTTPError, KeyError, ValueError, TypeError, ArithmeticError):
                continue
            if rate.is_finite() and rate > 0:
                _FX_CACHE[(base, quote)] = (time.monotonic(), rate, source, as_of)
                return rate, source, as_of
    return D("1"), "fallback", None


@router.get("/fx-rate", response_model=FxRateResponse)
async def fx_rate(base: str, quote: str) -> FxRateResponse:
    """Live FX rate. ?base=INR&quote=USD returns how many USD per 1 INR."""
    base, quote = base.upper(), quote.upper()
    rate, source, as_of = await _fetch_fx(base, quote)
    if source == "fallback":
        raise HTTPException(
            status_code=502,
            detail=f"FX provider unavailable or pair {base}/{quote} unsupported.",
        )
    return FxRateResponse(base=base, quote=quote, rate=rate, source=source, as_of=as_of)


@router.post("/cross-border-decision", response_model=CrossBorderResponse)
async def cross_border_decision(req: CrossBorderRequest) -> CrossBorderResponse:
    """Prepay vs invest decision for a user whose loan and savings are in different
    currencies. Live FX rate is fetched unless `manual_fx_rate` is provided."""
    if req.manual_fx_rate is not None:
        fx_rate_used = req.manual_fx_rate
    else:
        rate, source, _ = await _fetch_fx(req.loan_currency.upper(), req.user_currency.upper())
        if source == "fallback":
            raise HTTPException(
                status_code=502,
                detail=(
                    f"Could not fetch FX rate for {req.loan_currency}/{req.user_currency}. "
                    "Provide manual_fx_rate."
                ),
            )
        fx_rate_used = rate

    drift = (
        req.manual_fx_drift_annual
        if req.manual_fx_drift_annual is not None
        else historical_drift_default(req.loan_currency, req.user_currency)
    )

    verdict = evaluate_cross_border(CrossBorderInputs(
        loan_balance=req.loan_balance,
        loan_nominal_rate=req.loan_nominal_rate,
        loan_tenure_months=req.loan_tenure_months,
        fx_rate=fx_rate_used,
        user_savings_yield=req.user_savings_yield,
        user_marginal_tax=req.user_marginal_tax,
        expected_fx_drift_annual=drift,
        inflation_user_country=req.inflation_user_country,
    ))

    return CrossBorderResponse(
        fx_rate_used=fx_rate_used,
        fx_drift_used=drift,
        effective_loan_cost_in_user_currency=verdict.effective_loan_cost_in_user_currency,
        user_post_tax_yield=verdict.user_post_tax_yield,
        spread=verdict.spread,
        verdict=verdict.verdict,
        rationale=verdict.rationale,
        loan_emi_user_currency=verdict.loan_emi_user_currency,
        loan_emi_user_currency_y5=verdict.loan_emi_user_currency_y5,
    )
