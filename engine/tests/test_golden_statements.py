"""Golden statements (grill #67): engine balance vs the bank's own method,
month by month, on five simulated, anonymised statements built by
golden_statements_make.py from each bank's published convention.

Each fixture states a tolerance in this file, with the reason. A drift
beyond it is a real difference between the engine and how the bank
computes interest, not noise: the test names the month it first appears.
"""
from __future__ import annotations

import json
from decimal import Decimal as D
from pathlib import Path

import pytest

from engine.models import (Country, IncomeType, LifecycleEvent, LifecycleEventKind, Loan,
                           LoanType, TaxRegimeIN, User)
from engine.simulation import simulate_plan
from engine.ordering import Strategy

FIX = Path(__file__).parent / "fixtures" / "golden_statements"
KIND = {"home": LoanType.HOME, "personal": LoanType.PERSONAL, "car": LoanType.AUTO,
        "credit_card": LoanType.CREDIT_CARD, "education": LoanType.EDUCATION}

# Max allowed |engine − statement| on any month, as a share of the starting
# principal, and why.
TOLERANCE = {
    # Engine charges rate/12 every month; SBI charges days/365. A 31-day
    # month costs ~1.9% more interest than rate/12, a 28-day one ~8% less;
    # over a year they net to ~0, so the gap oscillates but stays small.
    "home_floating_sbi_style": D("0.0010"),
    "car_fixed_sbi_style": D("0.0010"),
    # Same convention as the engine: should agree to the paisa (rounding).
    "personal_fixed_monthly": D("0.00001"),
    # Engine: whole-month interest on (balance + this month's spend), before
    # the payment. HDFC: daily balance, spend from its own date, payment
    # from the due date. Engine is conservative (charges more).
    "card_revolving_hdfc_style": D("0.02"),
    # Engine compounds moratorium interest monthly; SBI charges simple
    # interest. 12 months at 10.15% on ₹10L: compounding adds ~₹4.7k.
    "education_moratorium_sbi_style": D("0.0010"),
}
# Months checked by the strict test. The home loan is checked through the
# year before its rate rise; the full 24 months are the known gap below.
CHECK_UNTIL = {"home_floating_sbi_style": 12}
# Real convention gaps found by these fixtures (strict xfail: the test turns
# red, "XPASS", the day the engine is fixed, so the integrator removes it).
KNOWN_GAPS = {
    "education_moratorium_sbi_style":
        "UNASSIGNED (integrator): engine compounds moratorium interest monthly (simulation.py "
        "'Moratorium / pre-first-EMI months'); SBI Student Loan MITC: 'Simple interest to be charged "
        "during moratorium period'. ~₹5.9k too high after 36 months on ₹10L.",
    "card_revolving_hdfc_style":
        "G1 (#25) / L3 (live #23): engine charges a whole month's interest on balance + new spend "
        "before the payment; HDFC charges daily from each transaction date and stops on the paid "
        "part from the payment date. Engine ~7.9% of the opening balance too high after 12 months.",
}
FULL_RUN_GAPS = {
    "home_floating_sbi_style":
        "G4 decision: after a cut (EMI kept, end date moves earlier) then a rise, _reset_rate raises "
        "the EMI to keep the NEW, earlier end date; the bank-style statement keeps the original "
        "maturity (EMI 22,196). Engine balance runs ~₹350/month lower after the rise.",
}


def load():
    return [json.loads(p.read_text()) for p in sorted(FIX.glob("*.json"))]


def _user(loan: Loan, events=None) -> User:
    return User(country=Country.IN, income_type=IncomeType.SALARIED,
                annual_income=D("12000000"), monthly_income=D("1000000"),
                fixed_expenses=D("0"), savings_balance=D("0"), primary_bank="SBI",
                tax_regime=TaxRegimeIN.NEW, loans=[loan])


def engine_balances(fx: dict) -> list[D]:
    kind = KIND[fx["loan_type"]]
    events = []
    if kind == LoanType.CREDIT_CARD:
        loan = Loan(loan_type=kind, bank="HDFC Bank", outstanding=D(fx["principal"]),
                    nominal_rate=D(fx["start_rate"]), rate_type="fixed", tenure_months_remaining=0,
                    scheduled_emi=D("0"), min_payment_override=D(fx["payment"]),
                    expected_monthly_spend=D(fx["monthly_spend"]), currency="INR")
    else:
        mor = int(fx.get("moratorium_months", 0))
        loan = Loan(loan_type=kind, bank="SBI", outstanding=D(fx["principal"]),
                    nominal_rate=D(fx["start_rate"]), rate_type=fx["rate_type"],
                    tenure_months_remaining=int(fx["tenure_months"]), scheduled_emi=D(fx["emi"]),
                    currency="INR")
        if mor:
            loan.first_payment_month = mor + 1
        for month, rate in (fx.get("rate_changes") or {}).items():
            events.append(LifecycleEvent(kind=LifecycleEventKind.FLOATING_RATE_RESET,
                                         effective_month=int(month), loan_index=0, new_rate=D(rate)))
    res = simulate_plan(_user(loan), Strategy.AVALANCHE, horizon_months=len(fx["rows"]),
                        minimums_only=True, lifecycle_events=events or None)
    out = [r.balances_by_loan_index.get(0, D("0")) for r in res.months]
    return out + [D("0")] * (len(fx["rows"]) - len(out))


def _params(gaps):
    return [pytest.param(f, id=f["id"], marks=[pytest.mark.xfail(reason=gaps[f["id"]], strict=True)]
                         if f["id"] in gaps else []) for f in load()]


@pytest.mark.parametrize("fx", _params(KNOWN_GAPS))
def test_engine_matches_statement_month_by_month(fx):
    _compare(fx, CHECK_UNTIL.get(fx["id"], len(fx["rows"])))


@pytest.mark.parametrize("fx", [p for p in _params(FULL_RUN_GAPS) if p.id in CHECK_UNTIL])
def test_engine_matches_statement_full_run(fx):
    _compare(fx, len(fx["rows"]))


def _compare(fx, until):
    tol = TOLERANCE[fx["id"]] * D(fx["principal"])
    got = engine_balances(fx)
    for row, eng in list(zip(fx["rows"], got))[:until]:
        want = D(row["closing_balance"])
        assert abs(eng - want) <= tol, (
            f"{fx['id']} {row['period']} (month {row['month']}): engine {eng:.2f} vs statement "
            f"{want:.2f}, off by {eng - want:.2f} (allowed ±{tol:.2f}); convention: {fx['convention']}")


def test_every_fixture_has_a_tolerance_and_is_marked_simulated():
    fxs = load()
    assert len(fxs) == 5
    for f in fxs:
        assert f["id"] in TOLERANCE
        assert f["simulated"] is True   # real statements, when added, set False
        assert {"home", "personal", "credit_card", "car", "education"} >= {f["loan_type"]}
