"""Layer 0 — Mandatory contributions floor (§4.3).

If an employer 401(k) / NPS Tier 1 / EPF VPF match is available and unmet,
that surplus routes there FIRST — even ahead of high-rate debt. The PV of
the match at retirement is virtually always > any debt's effective rate,
unless the user is paying credit-card interest AND the match window is tight.

The decision: how much of the available surplus to route to the match.
"""
from decimal import Decimal
from dataclasses import dataclass

D = Decimal


@dataclass
class EmployerMatch:
    """Generic employer-match config. Works for US 401(k), India NPS Tier 1, EPF VPF.

    `match_cap_pct` — employer matches contributions up to this fraction of salary.
    `match_rate`    — for every $1 you put in (up to cap), employer adds $match_rate.
                      US: typically 0.5 or 1.0 (50% or 100% match).
                      India NPS Tier 1: usually 1.0 (rupee-for-rupee on Tier 1).
    """
    name: str
    annual_salary: Decimal
    match_cap_pct: Decimal           # e.g. D("0.06") = 6% of salary
    match_rate: Decimal              # e.g. D("0.5") = 50¢ on the dollar
    current_user_contribution_pct: Decimal   # current self-contribution as % of salary
    expected_annual_return: Decimal  # e.g. D("0.07")
    years_to_retirement: int


def matched_monthly_contribution(match: EmployerMatch) -> Decimal:
    """Monthly self-contribution needed to capture the full unmet match.

    If user is already contributing ≥ match_cap_pct, returns 0 (nothing to capture).
    Otherwise returns the monthly *additional* self-contribution to top up to cap.
    """
    if match.current_user_contribution_pct >= match.match_cap_pct:
        return D("0")
    unmet_pct = match.match_cap_pct - match.current_user_contribution_pct
    return match.annual_salary * unmet_pct / D("12")


def match_pv_at_retirement(match: EmployerMatch) -> Decimal:
    """Present value at retirement of the *employer's* match contribution alone,
    assuming the unmet portion is captured monthly until retirement.

    Conservative single-shot annual compounding:
      annual_match = (match_cap_pct − current_pct) × salary × match_rate
      pv_at_ret    = annual_match × FV_annuity(years_to_retirement, return)
    """
    if match.current_user_contribution_pct >= match.match_cap_pct:
        return D("0")
    unmet_pct = match.match_cap_pct - match.current_user_contribution_pct
    annual_match = match.annual_salary * unmet_pct * match.match_rate
    r = match.expected_annual_return
    n = match.years_to_retirement
    if r == 0 or n <= 0:
        return annual_match * D(max(n, 0))
    factor = ((D("1") + r) ** n - D("1")) / r
    return annual_match * factor


def has_unmet_match(match: EmployerMatch | None) -> bool:
    if match is None:
        return False
    return match.current_user_contribution_pct < match.match_cap_pct
