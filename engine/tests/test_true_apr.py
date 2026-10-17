"""True annual cost (roadmap PR C): one formula with monthly compounding,
fees, GST and the tax benefit, differential-tested against its TypeScript
twin through engine/tests/fixtures/true_apr_cases.json."""
import importlib.util
from decimal import Decimal as D
from pathlib import Path

import pytest
from hypothesis import given, strategies as st

from engine.formulas import effective_rate
from engine.models import Country, Loan, LoanType
from engine.true_apr import TrueAprInputs, true_apr

ROOT = Path(__file__).resolve().parents[2]


def _exporter():
    spec = importlib.util.spec_from_file_location("export_true_apr_cases", ROOT / "scripts" / "export_true_apr_cases.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_differential_fixture_is_current():
    mod = _exporter()
    assert mod.OUT_PATH.read_text(encoding="utf-8") == mod.render(), (
        "engine/tests/fixtures/true_apr_cases.json is stale: run python scripts/export_true_apr_cases.py"
    )


def test_indian_card_includes_compounding_and_gst():
    loan = Loan(LoanType.CREDIT_CARD, "HDFC", D("50000"), D("0.42"), "fixed", 0, D("0"), currency="INR")
    t = true_apr(TrueAprInputs(0.42, None, gst_on_interest=0.18))
    # The old effective rate: 42% × 1.18 = 49.56%, no compounding.
    assert effective_rate(loan, D("0.3"), Country.IN) == D("0.4956")
    assert abs(t.compounding - ((1 + 0.42 / 12) ** 12 - 1 - 0.42)) < 1e-12
    assert abs(t.apr - ((1 + 0.42 / 12 * 1.18) ** 12 - 1)) < 1e-12
    assert t.apr > 0.62


def test_amortising_loan_without_extras_is_the_compounded_nominal():
    t = true_apr(TrueAprInputs(0.085, 180))
    assert abs(t.apr - ((1 + 0.085 / 12) ** 12 - 1)) < 1e-9
    assert t.gst == t.fees == t.tax == 0 or max(abs(t.gst), abs(t.fees), abs(t.tax)) < 1e-12


def test_fee_with_gst_and_tax_benefit_move_it_the_right_way():
    plain = true_apr(TrueAprInputs(0.105, 60))
    fee = true_apr(TrueAprInputs(0.105, 60, fee_rate=0.004, gst_on_fee=0.18))
    assert fee.fees > 0 and fee.gst > 0 and fee.apr > plain.apr
    home = true_apr(TrueAprInputs(0.085, 240, shield=0.3))
    assert home.tax < 0 and home.apr < true_apr(TrueAprInputs(0.085, 240)).apr


@given(
    nominal=st.floats(0, 0.6), months=st.sampled_from([None, 1, 12, 60, 240]),
    fee=st.floats(0, 0.03), gst=st.sampled_from([0.0, 0.18]), shield=st.floats(0, 0.45),
)
def test_components_add_up(nominal, months, fee, gst, shield):
    t = true_apr(TrueAprInputs(nominal, months, fee_rate=fee, gst_on_interest=gst, gst_on_fee=gst, shield=shield))
    assert abs(t.nominal + t.compounding + t.gst + t.fees + t.tax - t.apr) < 1e-9
    assert t.compounding >= -1e-9 and t.tax <= 1e-9


@pytest.mark.parametrize("nominal", [1.192092896e-07, 1e-9, 1e-6, 1e-4])
@pytest.mark.parametrize("months", [1, 2, 12, 240])
def test_tiny_rates_never_give_negative_compounding(nominal, months):
    """W5's Hypothesis finding: 1 − (1+r)^−n cancelled at r ≈ 1e-8 and gave
    compounding −7e-8. Compounding is never negative at any positive rate."""
    t = true_apr(TrueAprInputs(nominal, months))
    assert t.compounding >= -1e-12
    assert abs(t.nominal + t.compounding - t.apr) < 1e-12
