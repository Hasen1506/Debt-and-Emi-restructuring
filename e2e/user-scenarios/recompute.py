"""Independent EMI, tenure and card-minimum checks.

Reads a JSON list on stdin. Each case is compared with numpy-financial (EMI
and remaining months) or with the published HDFC average-daily-balance
minimum, not with RightDue's functions. Prints a JSON report.
"""
from __future__ import annotations

import json
import sys
from decimal import Decimal, ROUND_HALF_UP

import numpy_financial as npf


def rupee(n: float) -> int:
    return int(Decimal(str(n)).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def emi(principal: float, annual_rate: float, months: int) -> float:
    if months <= 0:
        return principal
    r = annual_rate / 12.0
    if r == 0:
        return principal / months
    return float(-npf.pmt(r, months, principal))


def months_left(principal: float, annual_rate: float, payment: float) -> float:
    r = annual_rate / 12.0
    if payment <= 0:
        return float("inf")
    return float(npf.nper(r, -payment, principal))


def hdfc_minimum(balance: float, annual_rate: float) -> int:
    """HDFC's published minimum, with interest on the average daily balance.

    Payment is assumed on the due date, about a third of the way before the
    cycle ends, and new spend is zero. Two fixed-point steps, as a statement
    would settle. GST is 18% on the finance charge.
    """
    bal = Decimal(str(balance))
    monthly = Decimal(str(annual_rate)) / Decimal(12)
    guess = bal * monthly * Decimal("1.18")
    payment = _hdfc_from_interest(bal, guess)
    for _ in range(2):
        adb = bal - payment / Decimal(3)
        if adb < 0:
            adb = Decimal(0)
        interest = adb * monthly * Decimal("1.18")
        payment = _hdfc_from_interest(bal, interest)
    return int(payment.quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def _hdfc_from_interest(balance: Decimal, interest_with_gst: Decimal) -> Decimal:
    fc = interest_with_gst / Decimal("1.18")
    gst = interest_with_gst - fc
    core = max(Decimal("0.05") * (fc + balance), fc + Decimal("0.05") * balance)
    return max(gst + core, Decimal(200))


def main() -> None:
    cases = json.load(sys.stdin)
    out = []
    for c in cases:
        kind = c.get("kind")
        row = {"id": c.get("id"), "kind": kind, "ok": True, "detail": ""}
        try:
            if kind == "emi":
                got = emi(c["principal"], c["annualRate"], c["months"])
                screen = float(c["screen"])
                row["expected"] = rupee(got)
                row["screen"] = screen
                row["ok"] = abs(got - screen) <= float(c.get("tolerance", 1))
                row["detail"] = f"numpy-financial pmt {got:.2f} vs screen {screen}"
            elif kind == "nper":
                got = months_left(c["principal"], c["annualRate"], c["payment"])
                screen = float(c["screen"])
                row["expected"] = round(got)
                row["screen"] = screen
                row["ok"] = abs(got - screen) <= float(c.get("tolerance", 1))
                row["detail"] = f"numpy-financial nper {got:.2f} vs screen {screen}"
            elif kind == "interest":
                got = c["principal"] * c["annualRate"] / 12.0
                screen = float(c["screen"])
                row["expected"] = rupee(got)
                row["screen"] = screen
                row["ok"] = abs(rupee(got) - screen) <= float(c.get("tolerance", 1))
                row["detail"] = f"balance × rate ÷ 12 = {got:.2f} vs screen {screen}"
            elif kind == "hdfc-min":
                got = hdfc_minimum(c["balance"], c["annualRate"])
                screen = int(c["screen"])
                row["expected"] = got
                row["screen"] = screen
                row["ok"] = abs(got - screen) <= int(c.get("tolerance", 1))
                row["detail"] = f"HDFC ADB minimum {got} vs screen {screen}"
            else:
                row["ok"] = False
                row["detail"] = f"unknown kind {kind}"
        except Exception as e:  # noqa: BLE001 — report the case, keep going
            row["ok"] = False
            row["detail"] = str(e)
        out.append(row)
    json.dump(out, sys.stdout)


if __name__ == "__main__":
    main()
