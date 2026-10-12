"""Sprint G4 (grill #35): every dated figure is in one registry and none is stale.

FRESHNESS_TODAY=YYYY-MM-DD overrides today's date (e.g. to preview what goes
stale next month). Otherwise the real date is used, so CI catches a figure
nobody refreshed.
"""
import os
from datetime import date
from decimal import Decimal

import pytest

from engine import data_freshness as df


def _today() -> date:
    v = os.environ.get("FRESHNESS_TODAY")
    return date.fromisoformat(v) if v else date.today()


def test_every_entry_has_source_url_date_and_cadence():
    es = df.entries()
    assert len(es) >= 15
    ids = [e.id for e in es]
    assert len(ids) == len(set(ids)), "duplicate registry ids"
    for e in es:
        assert e.source and e.url.startswith("https://"), e.id
        assert e.as_of is not None, f"{e.id}: no readable as-of date"
        assert e.cadence_days > 0 and e.how in {"auto", "by_hand"}, e.id


def test_nothing_is_stale():
    bad = df.stale(_today())
    msg = "\n".join(
        f"- {e.id}: checked {e.as_of}, due every {e.cadence_days} days. "
        f"Re-read {e.url} ({e.source}) and update it in code and engine/data_freshness.json."
        for e in bad
    )
    assert not bad, "Stale dated figures:\n" + msg


def test_stale_detection_works():
    """Regression: a far-future 'today' must flag everything."""
    assert len(df.stale(date(2099, 1, 1))) == len(df.entries())
    assert df.stale(date(2026, 10, 12)) == []


def test_code_constants_match_the_registry():
    checked = 0
    for e in df.entries():
        got = df.code_value(e)
        if got is None:
            continue
        checked += 1
        assert Decimal(got) == Decimal(e.value), f"{e.id}: code has {got}, registry {e.value}"
    assert checked >= 3


def test_required_figures_are_registered():
    ids = {e.id for e in df.entries()}
    for need in ("gap_card_apr_in", "gap_card_apr_us", "remittance_cost_us_in",
                 "inflation_long_run_in", "inflation_long_run_us",
                 "market_data:inflation.IN", "market_data:inflation.US", "policy_rates"):
        assert need in ids, need
    reg = {e.id: e for e in df.entries()}
    assert reg["gap_card_apr_in"].value == "0.45"
    assert reg["gap_card_apr_us"].value == "0.2236"


def test_gap_debt_constants_when_l2_is_merged():
    gd = pytest.importorskip("engine.gap_debt")
    assert str(gd.GAP_CARD_APR_IN) == "0.45"
    assert str(gd.GAP_CARD_APR_US) == "0.2236"
