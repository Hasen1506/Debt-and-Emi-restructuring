"""E7 (audit 80): a US federal or unmarked student loan never takes extra
payments by default; only the user's own "not on PSLF/IDR" answer releases it.

Rules (studentaid.gov PSLF page, read 2026-10-14, post-OBBBA): PSLF forgives
Direct Loans after 120 qualifying payments while working full time for a
government or not-for-profit employer; RAP and IBR payments qualify, Tiered
Standard payments don't. Paying extra on a loan heading for forgiveness only
shrinks what is forgiven.

Class guard: for EVERY combination of kind x answer x currency, the
simulator gives the loan extra only when the answer is "none" or the loan
is private / not a dollar loan.
"""
from decimal import Decimal
from itertools import product

import pytest

from engine import us_loans
from engine.models import Country, FilingStatusUS, IncomeType, Loan, LoanType, User
from engine.ordering import Strategy
from engine.simulation import simulate_plan, non_amortising_loans

D = Decimal


def _edu(**kw) -> Loan:
    base = dict(loan_type=LoanType.EDUCATION, bank="MOHELA", outstanding=D("38000"),
                nominal_rate=D("0.055"), rate_type="fixed", tenure_months_remaining=120,
                scheduled_emi=D("420"))
    base.update(kw)
    return Loan(**base)


def _car() -> Loan:
    return Loan(loan_type=LoanType.AUTO, bank="Ally", outstanding=D("22000"),
                nominal_rate=D("0.075"), rate_type="fixed", tenure_months_remaining=48,
                scheduled_emi=D("480"))


def _user(loans, country=Country.US) -> User:
    return User(country=country, income_type=IncomeType.SALARIED, annual_income=D("90000"),
                monthly_income=D("5200"), fixed_expenses=D("3000"), savings_balance=D("0"),
                primary_bank="Chase", filing_status=FilingStatusUS.SINGLE, loans=loans)


def _extra_on(res, idx, emi, months=60):
    return sum((max(D("0"), m.payments_by_loan_index.get(idx, D("0")) - emi)
                for m in res.months[:months]), D("0"))


KINDS = (None, "federal", "private")
ANSWERS = (None, "unsure", "none", "pslf", "idr")
CCYS = (None, "USD", "INR")


@pytest.mark.parametrize("kind,answer,ccy", list(product(KINDS, ANSWERS, CCYS)))
def test_extra_reaches_a_student_loan_only_when_the_user_released_it(kind, answer, ccy):
    # Only the student loan, so any spare cash would go to it if allowed.
    loan = _edu(student_loan_kind=kind, forgiveness_track=answer, currency=ccy)
    user = _user([loan], Country.US)
    if ccy == "INR":
        user.fx_to_user_currency = {"INR": D("0.0105")}
        loan.outstanding = D("3000000")
        loan.scheduled_emi = D("33000")
    res = simulate_plan(user, Strategy.AVALANCHE, horizon_months=60, marginal_rate=D("0.22"))
    got_extra = _extra_on(res, 0, loan.scheduled_emi) > 0
    released = kind == "private" or ccy == "INR" or answer == "none"
    assert got_extra == released, (kind, answer, ccy)
    # The reason the plan shows matches what the simulator did.
    assert (us_loans.forgiveness_prepay_block(loan, Country.US) is None) == released


def test_us_persona_extra_goes_to_the_car_not_the_unanswered_student_loan():
    """The audit's US persona after the cards clear: a 7.5% car and a 5.5%
    federal loan with no answer. The car takes the extra; the student loan
    gets its $420 and nothing more."""
    user = _user([_edu(), _car()])
    res = simulate_plan(user, Strategy.AVALANCHE, horizon_months=60, marginal_rate=D("0.22"))
    assert _extra_on(res, 0, D("420")) == 0
    assert _extra_on(res, 1, D("480")) > 0


def test_answer_none_releases_the_loan_and_it_is_prepaid_once_the_car_is_gone():
    user = _user([_edu(forgiveness_track="none"), _car()])
    res = simulate_plan(user, Strategy.AVALANCHE, horizon_months=120, marginal_rate=D("0.22"))
    assert _extra_on(res, 0, D("420"), months=120) > 0


def test_pending_reason_names_the_question_and_keeps_the_required_payment():
    why = us_loans.forgiveness_prepay_block(_edu(), Country.US)
    assert "PSLF" in why and "required payment still goes" in why
    lines = " ".join(us_loans.student_loan_explainer(_edu()))
    assert "Not yet answered" in lines and "Tiered Standard" in lines


def test_a_none_answer_still_gets_the_never_clears_warning():
    """'none' means a normal loan: an EMI below the interest must still be
    flagged as never clearing (only PSLF/IDR/unsure payments may be below
    interest, as income-driven payments can be)."""
    low = _edu(forgiveness_track="none", scheduled_emi=D("100"))
    assert non_amortising_loans(_user([low]))
    idr = _edu(forgiveness_track="idr", scheduled_emi=D("100"))
    assert not non_amortising_loans(_user([idr]))


def test_api_keeps_none_and_unsure_answers():
    from api.schemas import LoanIn  # noqa: WPS433 (import inside the test keeps engine tests light)
    for v, want in (("none", "none"), ("Unsure", "unsure"), ("", None), ("PSLF", "pslf")):
        m = LoanIn.model_validate({
            "loan_type": "education_loan", "bank": "MOHELA", "outstanding": "38000",
            "nominal_rate": "0.055", "rate_type": "fixed", "tenure_months_remaining": 120,
            "scheduled_emi": "420", "forgiveness_track": v,
        })
        assert m.forgiveness_track == want
