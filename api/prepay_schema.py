"""UX2 #20: one answer to "lower your EMI or finish sooner?" for the loan a
lump sum goes to, on its own schedule (engine/prepay_choice.py)."""
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel


class PrepayOption(BaseModel):
    mode: Literal["reduce_tenure", "reduce_emi"]
    old_emi: Decimal
    new_emi: Decimal
    old_months: int
    new_months: int
    interest_saved: Decimal
