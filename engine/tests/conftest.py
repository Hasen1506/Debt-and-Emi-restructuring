"""Engine tests run on the frozen rate cards (see fixtures/pin_rates)."""
import pytest

from engine.tests.fixtures.pin_rates import pin_frozen_rate_cards


def pytest_configure(config):
    config.addinivalue_line(
        "markers", "live_rate_cards: read the live rate cards, not the frozen test copy")


@pytest.fixture(autouse=True)
def _frozen_rate_cards(request):
    if request.node.get_closest_marker("live_rate_cards"):
        yield
        return
    restore = pin_frozen_rate_cards()
    yield
    restore()
