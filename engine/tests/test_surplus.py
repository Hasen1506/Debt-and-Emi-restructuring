"""§4.23 — available surplus + one-time buffer."""
from decimal import Decimal
from engine.surplus import (
    SurplusAllocation, allocate_surplus,
    compute_available_surplus, compute_available_buffer,
    compute_efund_monthly, compute_total_minimums,
)
from engine.models import (
    User, Loan, LoanType, Country, IncomeType, TaxRegimeIN,
)

D = Decimal


def _user(country=Country.IN, savings=D("200000"), efund_balance=D("50000"),
          efund_target=D("300000"), income_type=IncomeType.SALARIED,
          bank="HDFC Bank") -> User:
    return User(
        country=country, income_type=income_type,
        annual_income=D("1500000"), monthly_income=D("125000"),
        fixed_expenses=D("60000"), savings_balance=savings,
        primary_bank=bank, tax_regime=TaxRegimeIN.NEW,
        efund_balance=efund_balance, efund_target=efund_target,
    )


def _loan(loan_type=LoanType.CREDIT_CARD, outstanding=D("50000"),
          emi=D("0"), bank="HDFC Bank") -> Loan:
    return Loan(loan_type=loan_type, bank=bank, outstanding=outstanding,
                nominal_rate=D("0.36"), rate_type="fixed",
                tenure_months_remaining=12, scheduled_emi=emi)


def test_efund_monthly_zero_when_target_reached():
    user = _user(efund_balance=D("400000"), efund_target=D("300000"))
    assert compute_efund_monthly(user) == D("0")


def test_efund_monthly_amortised_over_12_months():
    user = _user(efund_balance=D("100000"), efund_target=D("300000"))
    # gap = 200000 / 12 ≈ 16,666.67
    assert compute_efund_monthly(user) == D("200000") / D("12")


def test_total_minimums_sums_across_loans():
    user = _user()
    card = _loan(LoanType.CREDIT_CARD, D("50000"))
    home = Loan(loan_type=LoanType.HOME, bank="HDFC Bank",
                outstanding=D("4000000"), nominal_rate=D("0.085"),
                rate_type="floating", tenure_months_remaining=240,
                scheduled_emi=D("34713"))
    # Card min (HDFC compound base) = 2500; home = 34713
    total = compute_total_minimums(user, [card, home])
    assert total == D("2500") + D("34713")


def test_available_surplus_basic():
    """Income 125k − expenses 60k − card_min 2500 − efund_monthly ~16667 = ~45833."""
    user = _user(efund_balance=D("100000"), efund_target=D("300000"))
    card = _loan(LoanType.CREDIT_CARD, D("50000"))
    surplus = compute_available_surplus(user, [card])
    expected = D("125000") - D("60000") - D("2500") - (D("200000") / D("12"))
    assert surplus == expected


def test_available_surplus_floored_at_zero():
    """If minimums exceed income, surplus floors at zero (never negative)."""
    user = _user()
    user.monthly_income = D("10000")
    user.fixed_expenses = D("8000")
    card = _loan(LoanType.CREDIT_CARD, D("500000"))   # min 5%×500k = 25000
    assert compute_available_surplus(user, [card]) == D("0")


def test_available_surplus_subtracts_variable_expenses():
    """variable_expenses (discretionary spending) reduces surplus 1-for-1,
    on top of fixed_expenses. Older payloads default to 0 so the field
    is non-breaking."""
    user = _user(efund_balance=D("400000"))
    card = _loan(LoanType.CREDIT_CARD, D("50000"))
    base = compute_available_surplus(user, [card])
    user.variable_expenses = D("8000")
    after = compute_available_surplus(user, [card])
    assert base - after == D("8000")


def test_available_surplus_subtracts_match():
    user = _user(efund_balance=D("400000"))
    card = _loan(LoanType.CREDIT_CARD, D("50000"))
    s0 = compute_available_surplus(user, [card])
    s1 = compute_available_surplus(user, [card], matched_contribution=D("5000"))
    assert s0 - s1 == D("5000")


def test_buffer_subtracts_mab_india():
    """HDFC urban MAB ₹10k → 200k − 10k − efund 300k = floor at 0."""
    user = _user(savings=D("200000"), efund_target=D("300000"))
    buf = compute_available_buffer(user, total_monthly_emis=D("30000"))
    assert buf == D("0")


def test_buffer_positive_when_savings_exceed_floors():
    user = _user(savings=D("500000"), efund_target=D("100000"), bank="HDFC Bank")
    # 500k − 10k MAB − 100k efund = 390k
    buf = compute_available_buffer(user, total_monthly_emis=D("30000"))
    assert buf == D("390000")


def test_buffer_business_owner_subtracts_dsr():
    """Business owner: 3× monthly EMIs reserve. ₹30k EMIs → 90k reserve."""
    user = _user(savings=D("500000"), efund_target=D("100000"),
                 income_type=IncomeType.BUSINESS_OWNER)
    buf = compute_available_buffer(user, total_monthly_emis=D("30000"))
    # 500k − 10k MAB − 100k efund − 90k DSR = 300k
    assert buf == D("300000")


def test_buffer_no_mab_for_us():
    """US: no MAB. 500k − 100k efund = 400k."""
    user = _user(country=Country.US, savings=D("500000"), efund_target=D("100000"))
    buf = compute_available_buffer(user, total_monthly_emis=D("30000"))
    assert buf == D("400000")


def test_total_minimums_converts_foreign_currency_loans_to_user_ccy():
    """NRI-US: $4,500 USD income, $1,200 USD card EMI, ₹40k INR home EMI.
    Without FX conversion the INR EMI would be summed as if it were USD —
    surplus would go deeply negative. With the FX map (1 INR = 0.012 USD),
    the home loan contributes 40,000 * 0.012 = $480 USD-equivalent."""
    user = User(
        country=Country.US, income_type=IncomeType.SALARIED,
        annual_income=D("54000"), monthly_income=D("4500"),
        fixed_expenses=D("1800"), savings_balance=D("20000"),
        primary_bank="JPMorgan Chase",
        filing_status=None,  # not exercising US-tax path here
        efund_balance=D("20000"), efund_target=D("20000"),
        is_nri_us=True,
        fx_to_user_currency={"INR": D("0.012")},
    )
    us_card = Loan(
        loan_type=LoanType.CREDIT_CARD, bank="Chase",
        outstanding=D("8000"), nominal_rate=D("0.249"),
        rate_type="fixed", tenure_months_remaining=0,
        scheduled_emi=D("1200"), currency="USD",
    )
    in_home = Loan(
        loan_type=LoanType.HOME, bank="HDFC Bank",
        outstanding=D("4000000"), nominal_rate=D("0.085"),
        rate_type="floating", tenure_months_remaining=240,
        scheduled_emi=D("40000"), currency="INR",
    )
    total = compute_total_minimums(user, [us_card, in_home])
    # Card min (Chase compound base) ≈ $200; home INR EMI 40000 * 0.012 = $480.
    # Exact card value depends on minimum_payment formula — just assert the
    # total is in a sane USD range. (~ $680 ± formula minor.)
    assert D("600") < total < D("800")


def test_total_minimums_no_op_when_loan_currency_matches_user_ccy():
    """Single-currency users are unaffected by the FX path — same totals
    as before the field existed (regression guard for the no-op claim)."""
    user = User(
        country=Country.IN, income_type=IncomeType.SALARIED,
        annual_income=D("1500000"), monthly_income=D("125000"),
        fixed_expenses=D("60000"), savings_balance=D("200000"),
        primary_bank="HDFC Bank", tax_regime=TaxRegimeIN.NEW,
        efund_balance=D("50000"), efund_target=D("300000"),
        # Intentionally provide an FX rate that would obviously distort if
        # mistakenly applied to same-currency loans.
        fx_to_user_currency={"INR": D("100")},
    )
    home = Loan(
        loan_type=LoanType.HOME, bank="HDFC Bank",
        outstanding=D("4000000"), nominal_rate=D("0.085"),
        rate_type="floating", tenure_months_remaining=240,
        scheduled_emi=D("34713"),
        # No currency tag → falls back to user residence (INR), so FX is a no-op.
    )
    total = compute_total_minimums(user, [home])
    assert total == D("34713")


def test_total_minimums_missing_fx_rate_falls_back_to_parity():
    """If the user supplies a loan in a foreign currency but no FX rate for
    it, the engine treats it as parity (rate=1) — wrong number but bounded
    behaviour. UI is expected to surface this gap as a warning."""
    user = User(
        country=Country.US, income_type=IncomeType.SALARIED,
        annual_income=D("60000"), monthly_income=D("5000"),
        fixed_expenses=D("2000"), savings_balance=D("20000"),
        primary_bank="JPMorgan Chase",
        efund_balance=D("20000"), efund_target=D("20000"),
        is_nri_us=True,
        # Deliberately empty — no FX rate provided.
        fx_to_user_currency={},
    )
    in_home = Loan(
        loan_type=LoanType.HOME, bank="HDFC Bank",
        outstanding=D("4000000"), nominal_rate=D("0.085"),
        rate_type="floating", tenure_months_remaining=240,
        scheduled_emi=D("40000"), currency="INR",
    )
    total = compute_total_minimums(user, [in_home])
    # Parity fallback: 40000 INR → 40000 (no conversion). Engine doesn't
    # crash; it returns a sum that's clearly off-scale for USD context.
    assert total == D("40000")


# ─── allocate_surplus ─────────────────────────────────────────────────────


def test_allocate_zero_surplus_returns_zeros():
    out = allocate_surplus(
        surplus=D("0"), ef_split=D("0.3"), ef_gap=D("50000"), ef_preempted=False,
    )
    assert out == SurplusAllocation(D("0"), D("0"), D("0"))


def test_allocate_negative_surplus_returns_zeros():
    out = allocate_surplus(
        surplus=D("-100"), ef_split=D("0.3"), ef_gap=D("50000"), ef_preempted=False,
    )
    assert out.goal_slice == D("0")
    assert out.ef_slice == D("0")
    assert out.debt_slice == D("0")


def test_allocate_preempted_routes_full_to_goal():
    out = allocate_surplus(
        surplus=D("10000"), ef_split=D("0.3"), ef_gap=D("50000"), ef_preempted=True,
    )
    assert out == SurplusAllocation(D("10000"), D("0"), D("0"))


def test_allocate_ef_under_target_splits_with_debt():
    # 30% of 10000 = 3000 to EF, 7000 to debt. EF gap (50k) > requested
    # slice (3k), so the full requested slice lands.
    out = allocate_surplus(
        surplus=D("10000"), ef_split=D("0.3"), ef_gap=D("50000"), ef_preempted=False,
    )
    assert out.goal_slice == D("0")
    assert out.ef_slice == D("3000")
    assert out.debt_slice == D("7000")


def test_allocate_ef_gap_caps_slice():
    # 30% of 10000 = 3000 wanted, but only 500 needed to close the gap.
    # The remainder (9500) lands on debt.
    out = allocate_surplus(
        surplus=D("10000"), ef_split=D("0.3"), ef_gap=D("500"), ef_preempted=False,
    )
    assert out.ef_slice == D("500")
    assert out.debt_slice == D("9500")


def test_allocate_ef_met_routes_all_to_debt():
    out = allocate_surplus(
        surplus=D("10000"), ef_split=D("0.3"), ef_gap=D("0"), ef_preempted=False,
    )
    assert out.ef_slice == D("0")
    assert out.debt_slice == D("10000")


def test_allocate_zero_split_routes_all_to_debt():
    out = allocate_surplus(
        surplus=D("10000"), ef_split=D("0"), ef_gap=D("50000"), ef_preempted=False,
    )
    assert out.ef_slice == D("0")
    assert out.debt_slice == D("10000")


def test_allocate_invariant_slices_sum_to_surplus():
    out = allocate_surplus(
        surplus=D("12345.67"), ef_split=D("0.3"), ef_gap=D("9999"), ef_preempted=False,
    )
    assert out.goal_slice + out.ef_slice + out.debt_slice == D("12345.67")


# ─── post-goal surplus cascade ────────────────────────────────────────────
# The multi-goal path no longer goes through `allocate_surplus` — the
# caller (engine loop / snapshot route) subtracts goal outflow first
# and then invokes the cascade on the post-goal residual. These tests
# pin the cascade shape under that contract.


def test_post_goal_cascade_splits_remainder_with_ef():
    # Caller has already pulled 4k for goals; 6k residual cascades.
    # EF wants 30% of 6k = 1800, debt gets the rest.
    out = allocate_surplus(
        surplus=D("6000"), ef_split=D("0.3"), ef_gap=D("50000"),
        ef_preempted=False,
    )
    assert out.goal_slice == D("0")
    assert out.ef_slice == D("1800")
    assert out.debt_slice == D("4200")


def test_post_goal_cascade_zero_residual_returns_zeros():
    # Goals ate everything — residual is 0, cascade emits no slices.
    out = allocate_surplus(
        surplus=D("0"), ef_split=D("0.3"), ef_gap=D("50000"),
        ef_preempted=False,
    )
    assert out == SurplusAllocation(D("0"), D("0"), D("0"))


def test_post_goal_cascade_respects_ef_preempted_on_residual():
    # ef_preempted means "any residual goes 100% to the goal slice"
    # (legacy single-preempt path). With goals fully handled externally
    # this is rarely hit but the contract still applies.
    out = allocate_surplus(
        surplus=D("7000"), ef_split=D("0.3"), ef_gap=D("50000"),
        ef_preempted=True,
    )
    assert out == SurplusAllocation(D("7000"), D("0"), D("0"))


def test_post_goal_cascade_capped_ef_gap():
    # Residual 6k, EF gap only 500 → 500 to EF, 5500 to debt.
    out = allocate_surplus(
        surplus=D("6000"), ef_split=D("0.3"), ef_gap=D("500"),
        ef_preempted=False,
    )
    assert out.ef_slice == D("500")
    assert out.debt_slice == D("5500")
