"""Layer 0 — employer match (§4.3)."""
from decimal import Decimal
from engine.layer0 import (
    EmployerMatch, matched_monthly_contribution, match_pv_at_retirement,
    has_unmet_match,
)

D = Decimal


def _match(current_pct=D("0.03"), cap_pct=D("0.06"), match_rate=D("0.5"),
           salary=D("120000"), years=20, ret=D("0.07")) -> EmployerMatch:
    return EmployerMatch(
        name="401k", annual_salary=salary,
        match_cap_pct=cap_pct, match_rate=match_rate,
        current_user_contribution_pct=current_pct,
        expected_annual_return=ret, years_to_retirement=years,
    )


def test_unmet_match_detected():
    m = _match(current_pct=D("0.03"), cap_pct=D("0.06"))
    assert has_unmet_match(m) is True


def test_no_unmet_when_already_at_cap():
    m = _match(current_pct=D("0.06"), cap_pct=D("0.06"))
    assert has_unmet_match(m) is False
    assert matched_monthly_contribution(m) == D("0")


def test_monthly_contribution_to_top_up():
    """Salary $120k, cap 6%, current 3% → unmet 3% → $300/mo to capture."""
    m = _match(salary=D("120000"), current_pct=D("0.03"), cap_pct=D("0.06"))
    # 120000 × 0.03 / 12 = 300
    assert matched_monthly_contribution(m) == D("300")


def test_pv_at_retirement_growth():
    """Annual employer match = 120k × 3% × 0.5 = $1800. Over 20 yrs at 7%, FV ≈ $73,800."""
    m = _match(salary=D("120000"), current_pct=D("0.03"), cap_pct=D("0.06"),
               match_rate=D("0.5"), ret=D("0.07"), years=20)
    pv = match_pv_at_retirement(m)
    assert pv > D("70000") and pv < D("80000")


def test_pv_zero_when_no_unmet():
    m = _match(current_pct=D("0.06"), cap_pct=D("0.06"))
    assert match_pv_at_retirement(m) == D("0")
