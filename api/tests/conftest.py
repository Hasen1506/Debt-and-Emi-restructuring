"""Shared fixtures — a realistic India user with two loans for round-trip tests."""
import os
from decimal import Decimal
import pytest
from fastapi.testclient import TestClient

# Tests never reach FRED or the RBI website; feed tests pass their own fetcher.
os.environ.setdefault("RATES_FEED", "off")
# The fuzz sends thousands of requests from one client; limits have their own tests.
os.environ.setdefault("RATE_LIMITS", "off")

from api import outcomes_store
from api.main import app
from engine.tests.fixtures.pin_rates import pin_frozen_rate_cards

D = Decimal


def pytest_configure(config):
    config.addinivalue_line(
        "markers", "live_rate_cards: read the live rate cards, not the frozen test copy")


@pytest.fixture(autouse=True)
def _frozen_rate_cards(request):
    """Bank rates as of 14 May 2026, so refreshing the live cards never moves
    a test's expected numbers (engine/tests/fixtures/pin_rates)."""
    if request.node.get_closest_marker("live_rate_cards"):
        yield
        return
    restore = pin_frozen_rate_cards()
    yield
    restore()


@pytest.fixture(autouse=True)
def _fresh_engine_cache():
    """NEW-19: a plan cached by one test (other pinned rates, other
    monkeypatches) must not answer the next."""
    from api.engine_cache import engine_cache
    engine_cache.clear()
    yield
    engine_cache.clear()


@pytest.fixture(autouse=True)
def _fresh_fx_cache():
    """A quote cached by one test must not answer the next."""
    from api.routes import fx
    fx._FX_CACHE.clear()
    yield
    fx._FX_CACHE.clear()


@pytest.fixture(autouse=True)
def outcome_store(tmp_path):
    """Every test gets its own empty outcome store, never api/data's."""
    s = outcomes_store.OutcomeStore(outcomes_store.sqlite_engine(tmp_path / "outcomes.sqlite3"), key=b"test-key")
    outcomes_store.set_store(s)
    yield s
    outcomes_store.set_store(None)


@pytest.fixture()
def client() -> TestClient:
    return TestClient(app)


@pytest.fixture()
def india_user_payload() -> dict:
    """A salaried India user with a home loan + credit card."""
    return {
        "country": "IN",
        "income_type": "salaried",
        "annual_income": "1800000",
        "monthly_income": "150000",
        "fixed_expenses": "45000",
        "savings_balance": "300000",
        "primary_bank": "HDFC Bank",
        "location_tier": "urban",
        "tax_regime": "new",
        "efund_balance": "150000",
        "efund_target": "300000",
        "loans": [
            {
                "loan_type": "home_loan",
                "bank": "HDFC Bank",
                "outstanding": "3500000",
                "nominal_rate": "0.0850",
                "rate_type": "floating",
                "tenure_months_remaining": 180,
                "scheduled_emi": "35200",
                "property_use": "self_occupied",
            },
            {
                "loan_type": "credit_card",
                "bank": "HDFC Bank",
                "outstanding": "80000",
                "nominal_rate": "0.42",
                "rate_type": "fixed",
                "tenure_months_remaining": 0,
                "scheduled_emi": "4000",
            },
        ],
        "investment_options": [
            {
                "name": "Liquid fund",
                "expected_return": "0.068",
                "liquidity_class": "liquid",
                "is_in_pool": True,
            },
        ],
        "annual_hike_rate": "0.08",
        "inflation_rate": "0.046",
    }
