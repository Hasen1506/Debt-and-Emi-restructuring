"""Advance tax for salaried users with income that has no TDS (round 2,
item 5). Engine: engine/tax/advance_tax.py (law and sources there)."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Literal, Optional

from fastapi import APIRouter, HTTPException
from pydantic import Field

from api.schemas import Amount, _Base, _In
from engine.models import TaxRegimeIN
from engine.tax.advance_tax import AdvanceTaxInputError, OtherIncome, salaried_advance_tax

router = APIRouter()
D = Decimal


class OtherIncomeIn(_In):
    kind: Literal["interest", "rent", "freelance", "capital_gains", "other"]
    gross_annual: Amount
    tds_pct: Decimal = Field(default=D("0"), ge=D("0"), le=D("1"))
    presumptive: bool = True
    cg_kind: Literal["equity_stcg", "equity_ltcg", "other"] = "other"


class SalariedAdvanceTaxRequest(_In):
    annual_gross_salary: Amount
    tax_regime: TaxRegimeIN = TaxRegimeIN.NEW
    age: Optional[int] = Field(default=None, ge=16, le=110)
    resident: bool = True
    streams: list[OtherIncomeIn] = Field(default_factory=list, max_length=30)
    today: Optional[str] = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")


class InstalmentOut(_Base):
    due: str
    cumulative_share: Decimal
    amount: Decimal
    cumulative: Decimal


class SalariedAdvanceTaxResponse(_Base):
    applies: bool
    liability: Decimal
    reason: str
    tax_total: Decimal
    tax_on_salary: Decimal
    tds_on_other: Decimal
    presumptive: bool
    fiscal_year_label: str
    instalments: list[InstalmentOut]
    interest_234c_if_unpaid: Decimal
    interest_234b_if_unpaid: Decimal
    interest_if_unpaid: Decimal
    assumptions: list[str]
    sources: dict[str, str]
    threshold: Decimal = D("10000")


def _today_ist():
    return (datetime.now(timezone.utc) + timedelta(hours=5, minutes=30)).date()


@router.post("/tax/advance-tax/salaried", response_model=SalariedAdvanceTaxResponse)
def salaried(req: SalariedAdvanceTaxRequest) -> SalariedAdvanceTaxResponse:
    today = datetime.strptime(req.today, "%Y-%m-%d").date() if req.today else _today_ist()
    try:
        r = salaried_advance_tax(
            req.annual_gross_salary,
            [OtherIncome(s.kind, s.gross_annual, s.tds_pct, s.presumptive, s.cg_kind) for s in req.streams],
            req.tax_regime, today, req.age, req.resident,
        )
    except AdvanceTaxInputError as e:
        raise HTTPException(status_code=422, detail={"field": e.field, "message": str(e)})
    return SalariedAdvanceTaxResponse(
        applies=r.applies, liability=r.liability, reason=r.reason, tax_total=r.tax_total,
        tax_on_salary=r.tax_on_salary, tds_on_other=r.tds_on_other, presumptive=r.presumptive,
        fiscal_year_label=f"FY {r.fy_start}-{(r.fy_start + 1) % 100:02d}",
        instalments=[InstalmentOut(due=i.due.isoformat(), cumulative_share=i.cumulative_share, amount=i.amount,
                                   cumulative=i.cumulative) for i in r.instalments],
        interest_234c_if_unpaid=r.interest_234c_if_unpaid, interest_234b_if_unpaid=r.interest_234b_if_unpaid,
        interest_if_unpaid=r.interest_if_unpaid, assumptions=r.assumptions, sources=r.sources,
    )
