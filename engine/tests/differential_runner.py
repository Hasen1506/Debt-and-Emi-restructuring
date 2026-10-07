"""Runs plan cases through whichever `engine` package is importable.

Used two ways by test_differential_pre_pr29.py:
  * imported in-process, it runs the CURRENT engine;
  * executed as a script with PYTHONPATH pointing at a `git archive` of
    commit c753849, it runs the PRE-PR-29 engine on the same cases
    (JSON on stdin → JSON on stdout), so both engines see identical input.

It deliberately imports nothing from the test tree and uses only the
engine API that both versions share.
"""
from __future__ import annotations

import json
import sys
from decimal import Decimal

D = Decimal


def build_user(case: dict):
    from engine.models import (
        Country, IncomeType, InvestmentOption, LiquidityClass, Loan, LoanType, TaxRegimeIN, User,
    )

    loans = []
    for l in case["loans"]:
        loans.append(Loan(
            loan_type=LoanType(l["loan_type"]), bank=l.get("bank", "SBI"),
            outstanding=D(l["outstanding"]), nominal_rate=D(l["nominal_rate"]),
            rate_type=l.get("rate_type", "fixed"),
            tenure_months_remaining=int(l["tenure"]), scheduled_emi=D(l["emi"]),
            currency=l.get("currency"),
            min_payment_override=D(l["min_override"]) if l.get("min_override") else None,
            prepayment_penalty_pct=D(l.get("penalty", "0")),
            prepay_lock_in_months=int(l.get("lock_in", 0)),
            pre_emi_months_remaining=int(l.get("pre_emi", 0)),
            first_payment_month=int(l.get("first_payment_month", 1)),
        ))
    country = Country(case["country"])
    opts = [InvestmentOption(name="liquid", expected_return=D(r), liquidity_class=LiquidityClass.LIQUID,
                             is_in_pool=True) for r in case.get("liquid_returns", [])]
    income = D(case["income"])
    return User(
        country=country, income_type=IncomeType.SALARIED, annual_income=income * 12,
        monthly_income=income, fixed_expenses=D(case.get("expenses", "0")), savings_balance=D("0"),
        primary_bank="SBI", tax_regime=TaxRegimeIN.NEW if country == Country.IN else None,
        loans=loans, investment_options=opts,
        annual_hike_rate=D(case.get("annual_hike_rate", "0")),
        hike_schedule=[(a, b, D(r)) for a, b, r in case.get("hike_schedule", [])],
        fx_to_user_currency={k: D(v) for k, v in case.get("fx", {}).items()},
    )


def _summary(result) -> dict:
    return {
        "debt_free_month": result.debt_free_month,
        "total_interest": str(result.total_interest_paid),
        "total_invested": str(result.total_invested),
        "months": [
            [str(r.balance_in_user_currency) if hasattr(r, "balance_in_user_currency") else None,
             str(r.interest_paid_month), str(r.invested_this_month), str(r.available_surplus)]
            for r in result.months
        ],
    }


def run_case(case: dict) -> dict:
    from engine.ordering import Strategy
    from engine.simulation import baseline_minimums_only, simulate_plan

    out: dict = {}
    for mode in case.get("modes", ["plan", "baseline"]):
        try:
            user = build_user(case)
            if mode == "plan":
                res = simulate_plan(user, strategy=Strategy(case.get("strategy", "avalanche")),
                                    horizon_months=case.get("horizon", 360))
            else:
                res = baseline_minimums_only(user, horizon_months=case.get("horizon", 360))
            out[mode] = _summary(res)
        except Exception as e:  # recorded, compared by the test
            out[mode] = {"error": type(e).__name__, "message": str(e)}
    return out


def main() -> None:
    cases = json.load(sys.stdin)
    json.dump([run_case(c) for c in cases], sys.stdout)


if __name__ == "__main__":
    main()
