"""Swap the live rate cards and market yields for the frozen test copy, in place.

Modules import the lists and the lookup dicts by name, so their contents are
replaced (not the names rebound) and put back afterwards. The market yields
(web/src/lib/market-data.json) change every week; tests use the September
2026 figures they were written against.
"""
from decimal import Decimal as D

from engine import country_data, decisions, rate_cards
from engine.models import Country
from engine.tests.fixtures import frozen_rate_cards as frozen

_FROZEN_LIQUID = {
    Country.IN: (D("0.065"), "Liquid mutual fund ~6.5%"),
    Country.US: (D("0.0425"), "HYSA top-tier ~4.25%"),
}
_FROZEN_ASSET_RETURNS = (
    (country_data.ASSET_DEFAULT_RETURNS_IN, "fixed_deposit", D("0.0625")),
    (country_data.ASSET_DEFAULT_RETURNS_US, "savings_balance", D("0.04")),
)

_LISTS = ("INDIA_TIER_A", "INDIA_TIER_B", "INDIA_TIER_C", "INDIA_FINTECH",
          "USA_TIER_A", "USA_TIER_B", "USA_TIER_C")


def pin_frozen_rate_cards():
    """Install the frozen cards; returns a function that restores the live ones."""
    saved = {name: list(getattr(rate_cards, name)) for name in _LISTS}
    saved_index = dict(rate_cards.ALL_INSTITUTIONS)
    for name in _LISTS:
        getattr(rate_cards, name)[:] = getattr(frozen, name)
    rate_cards.ALL_INSTITUTIONS.clear()
    rate_cards.ALL_INSTITUTIONS.update(frozen.ALL_INSTITUTIONS)
    saved_liquid = dict(decisions.DEFAULT_BEST_LIQUID)
    decisions.DEFAULT_BEST_LIQUID.update(_FROZEN_LIQUID)
    saved_returns = [(table, key, table[key]) for table, key, _ in _FROZEN_ASSET_RETURNS]
    for table, key, value in _FROZEN_ASSET_RETURNS:
        table[key] = value

    def restore():
        for name in _LISTS:
            getattr(rate_cards, name)[:] = saved[name]
        rate_cards.ALL_INSTITUTIONS.clear()
        rate_cards.ALL_INSTITUTIONS.update(saved_index)
        decisions.DEFAULT_BEST_LIQUID.update(saved_liquid)
        for table, key, value in saved_returns:
            table[key] = value

    return restore
