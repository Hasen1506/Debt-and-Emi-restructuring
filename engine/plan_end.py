"""The debt-free month a plan may show (audit 80+ C11; UX walkthrough fix 2).

A plan the gap credit limit can't carry (``infeasible_from_month`` set)
still reaches a ``debt_free_month`` on paper, paying with money that can't
be found. No surface shows that date: every engine answer that carries a
debt-free month reads it through here, as the web reads it through
``lib/plan-gap.shownDebtFreeMonth``."""
from __future__ import annotations

from typing import Optional


def shown_debt_free_month(res) -> Optional[int]:
    """``res.debt_free_month``, or None when the plan is capped."""
    if res is None or getattr(res, "infeasible_from_month", None) is not None:
        return None
    return res.debt_free_month
