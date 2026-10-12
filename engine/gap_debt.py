"""What a short month really costs (grill #38).

When income doesn't cover costs plus every minimum payment, the plan used to
assume the gap "was found somewhere" and carried on as if it were free. In
real life it comes out of savings first and then goes on a credit card,
where it costs card interest until it is paid back. The simulator now does
the same (engine/simulation.py, the shortfall path):

1. the gap is taken from the emergency fund while there is money in it;
2. the rest is borrowed at a credit card's rate ("gap borrowing");
3. gap borrowing charges interest every month (in India with 18% GST on the
   finance charge, the same rule as any Indian card in this engine);
4. any spare cash, and any EMI a cleared loan frees up, pays the gap
   borrowing back before it goes anywhere else: it is the dearest debt;
5. the plan is debt-free only when the gap borrowing is paid back too.

Which rate: the highest rate on a card the user already has in their own
currency (that is the line the gap would actually go on). With no card on
file, the country default below.

Sources (as-of dates are when the figure was read):
- India: SBI Card "Most Important Terms and Conditions", Finance Charges:
  "3.75% p.m. (45% p.a.) for unsecured cards", plus applicable taxes (GST
  18%). Page states it is correct as per 22 July 2025; read 12 Oct 2026.
  https://www.sbicard.com/en/most-important-terms-and-conditions.page
  The same 3.75%/month top rate is in this repo's rate cards for HDFC Bank,
  ICICI Bank and Kotak (engine/rate_cards.py, last_verified 2026-10-09).
- USA: Federal Reserve G.19 Consumer Credit, "Credit card plans, accounts
  assessed interest": 22.36% (August 2026, released 7 Oct 2026; read
  12 Oct 2026). https://www.federalreserve.gov/releases/g19/current/default.htm
  "Accounts assessed interest" is the rate people who carry a balance
  actually pay, which is the case here.
Refresh: when the G.19 release changes the figure by more than half a point,
or when the big Indian issuers change their top card rate.
"""
from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal

from engine.formulas import monthly_interest_charge
from engine.models import Country, Loan, LoanType, User
from engine.surplus import _user_residence_currency, loan_currency_or_default

D = Decimal

GAP_CARD_APR_IN = D("0.45")
GAP_CARD_APR_IN_SOURCE = (
    "SBI Card MITC: 3.75% a month (45% a year) plus 18% GST "
    "(as of 22 Jul 2025, read 12 Oct 2026)"
)
GAP_CARD_APR_IN_URL = "https://www.sbicard.com/en/most-important-terms-and-conditions.page"
GAP_CARD_APR_US = D("0.2236")
GAP_CARD_APR_US_SOURCE = (
    "Federal Reserve G.19: credit card plans, accounts assessed interest, "
    "Aug 2026 (released 7 Oct 2026)"
)
GAP_CARD_APR_US_URL = "https://www.federalreserve.gov/releases/g19/current/default.htm"
GAP_CARD_AS_OF = "2026-10-12"


@dataclass(frozen=True)
class GapRate:
    """The yearly rate gap borrowing is charged (before GST) and why."""
    annual_rate: Decimal
    # "your_card": the dearest card on file in the user's currency;
    # "default": the country default above.
    basis: str
    source: str


def gap_rate_for(user: User) -> GapRate:
    ccy = _user_residence_currency(user).upper()
    own = [
        l.nominal_rate for l in user.loans
        if l.loan_type == LoanType.CREDIT_CARD
        and loan_currency_or_default(l, user) == ccy
        and l.nominal_rate > 0
    ]
    if own:
        return GapRate(max(own), "your_card", "the highest rate on a card on your profile")
    market = Country.IN if ccy == "INR" else Country.US if ccy == "USD" else user.country
    if market == Country.IN:
        return GapRate(GAP_CARD_APR_IN, "default", GAP_CARD_APR_IN_SOURCE)
    return GapRate(GAP_CARD_APR_US, "default", GAP_CARD_APR_US_SOURCE)


def gap_interest(balance: Decimal, rate: GapRate, user: User) -> Decimal:
    """One month's charge on gap borrowing, in the user's currency. Uses the
    engine's own card rule (monthly rate, plus GST on Indian cards) so the
    gap is charged exactly like the card it would sit on."""
    if balance <= 0:
        return D("0")
    card = Loan(
        loan_type=LoanType.CREDIT_CARD, bank="gap borrowing",
        outstanding=balance, nominal_rate=rate.annual_rate, rate_type="fixed",
        tenure_months_remaining=0, scheduled_emi=D("0"),
        currency=_user_residence_currency(user),
    )
    return monthly_interest_charge(card, user.country)
