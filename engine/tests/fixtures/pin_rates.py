"""Swap the live rate cards for the frozen test copy, in place.

Modules import the lists and the lookup dict by name, so their contents are
replaced (not the names rebound) and put back afterwards.
"""
from engine import rate_cards
from engine.tests.fixtures import frozen_rate_cards as frozen

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

    def restore():
        for name in _LISTS:
            getattr(rate_cards, name)[:] = saved[name]
        rate_cards.ALL_INSTITUTIONS.clear()
        rate_cards.ALL_INSTITUTIONS.update(saved_index)

    return restore
