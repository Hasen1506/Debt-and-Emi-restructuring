"""Write the differential cases for the marginal cost of prepaying
(engine/marginal_cost.py vs web/src/lib/marginal-cost.ts) to
engine/tests/fixtures/marginal_cost_cases.json.

Three kinds of case, fixed seed, so the file only changes when the formula does:
- "cost":      marginal_cost(...) on random inputs, every component
- "shield":    marginal_shield(...) across loan types, countries, regimes and caps
- "portfolio": user_marginal_costs on a small portfolio, and the avalanche order

The engine test fails if the file is stale; the web test fails if the
TypeScript twin differs on any case.

Usage: python scripts/export_marginal_cost_cases.py
"""
from __future__ import annotations

import json
import random
import sys
from decimal import Decimal as D
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from engine.marginal_cost import marginal_cost, marginal_shield, user_marginal_costs  # noqa: E402
from engine.models import Country, IncomeType, Loan, LoanType, TaxRegimeIN, User  # noqa: E402

OUT_PATH = ROOT / "engine" / "tests" / "fixtures" / "marginal_cost_cases.json"
TYPES = ["credit_card", "personal_loan", "home_loan", "auto_loan", "education_loan", "gold_loan", "bnpl"]


def _s(v: D) -> str:
    return format(v.normalize() if v != 0 else D("0"), "f")


def _mc(mc) -> dict:
    return {"interest": str(mc.interest), "gst": str(mc.gst), "tax_benefit": str(mc.tax_benefit),
            "fee": str(mc.fee), "lock_in_months": mc.lock_in_months, "total": str(mc.total),
            "order_key": str(mc.order_key)}


def cases() -> dict:
    rng = random.Random(20261007)
    cost = []
    for _ in range(80):
        args = {
            "nominal_rate": _s(D(rng.randint(0, 4800)) / 10000),
            "card_gst": rng.random() < 0.3,
            "shield_fraction": _s(rng.choice([D("0"), D("0.1"), D("0.2"), D("0.3"), D("0.312"), D("0.37")])),
            "prepayment_fee_pct": _s(rng.choice([D("0"), D("0"), D("0.01"), D("0.02"), D("0.03"), D("0.05")])),
            "months_left": rng.choice([0, 1, 3, 6, 12, 36, 60, 240]),
            "lock_in_months": rng.choice([0, 0, 0, 1, 6, 12]),
        }
        mc = marginal_cost(D(args["nominal_rate"]), args["card_gst"], D(args["shield_fraction"]),
                           D(args["prepayment_fee_pct"]), args["months_left"], args["lock_in_months"])
        cost.append({"args": args, "out": _mc(mc)})

    shield = []
    for lt in TYPES:
        for country in ("IN", "US"):
            for regime in ("old", "new"):
                for itemises, share in ((True, D("1")), (True, D("0.4")), (False, D("0")), (True, D("0"))):
                    for interest, debt in ((D("150000"), D("400000")), (D("200000"), D("800000")), (D("2000"), D("749999")), (D("2500"), D("750000"))):
                        args = {"loan_type": lt, "country": country, "marginal_rate": "0.3", "regime": regime,
                                "itemises": itemises, "itemised_share": _s(share), "interest_total": _s(interest),
                                "debt_total": _s(debt), "phaseout_factor": rng.choice(["1", "0.5"])}
                        out = marginal_shield(lt, country, D("0.3"), regime, itemises, share, interest, debt, D(args["phaseout_factor"]))
                        shield.append({"args": args, "out": str(out)})

    portfolio = []
    for _ in range(60):
        country = rng.choice([Country.IN, Country.US])
        regime = rng.choice([TaxRegimeIN.OLD, TaxRegimeIN.NEW])
        marg = rng.choice([D("0"), D("0.2"), D("0.3"), D("0.312")])
        loans = []
        for i in range(rng.randint(1, 5)):
            lt = rng.choice(TYPES)
            if country == Country.US and lt == "home_loan":
                # The US mortgage shield depends on itemising, which the web
                # derives from deductions (usMortgageShieldShare); left to the unit tests.
                lt = "personal_loan"
            loans.append(Loan(
                LoanType(lt), f"B{i}", D(rng.randrange(1000, 3_000_000, 500)), D(rng.randint(0, 4800)) / 10000,
                "fixed", rng.choice([0, 6, 24, 60, 180]) if lt != "credit_card" else 0, D("0"),
                processing_fee_amortised=rng.choice([D("0"), D("0.004")]),
                insurance_premium_pct=rng.choice([D("0"), D("0.002")]),
                currency=rng.choice([None, None, "INR", "USD"]),
                prepayment_penalty_pct=rng.choice([D("0"), D("0"), D("0.02"), D("0.04")]),
                prepay_lock_in_months=rng.choice([0, 0, 0, 6]),
            ))
        user = User(country, IncomeType.SALARIED, D("1200000"), D("100000"), D("30000"), D("0"), "HDFC",
                    tax_regime=regime if country == Country.IN else None)
        mcs = user_marginal_costs(loans, user, marg)
        order = sorted(range(len(loans)), key=lambda i: mcs[id(loans[i])].order_key, reverse=True)
        portfolio.append({
            "user": {"country": country.value, "tax_regime": regime.value if country == Country.IN else None},
            "marginal_rate": str(marg),
            "loans": [{
                "loan_type": l.loan_type.value, "outstanding": _s(l.outstanding), "nominal_rate": _s(l.nominal_rate),
                "tenure_months_remaining": l.tenure_months_remaining, "currency": l.currency,
                "processing_fee_amortised": _s(l.processing_fee_amortised), "insurance_premium_pct": _s(l.insurance_premium_pct),
                "prepayment_penalty_pct": _s(l.prepayment_penalty_pct), "prepay_lock_in_months": l.prepay_lock_in_months,
            } for l in loans],
            "costs": [_mc(mcs[id(l)]) for l in loans],
            "avalanche": order,
        })
    return {"cost": cost, "shield": shield, "portfolio": portfolio}


def render() -> str:
    return json.dumps(cases(), indent=1) + "\n"


if __name__ == "__main__":
    OUT_PATH.write_text(render(), encoding="utf-8")
    print(f"wrote {OUT_PATH}")
