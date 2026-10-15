"""How a loan contract behaves over time (Audit 80+ Section C, items 1-3, 6, 15).

The arithmetic core (EMI, amortisation) lives in engine/formulas.py. This
module holds the rules about the *contract*: what happens to the EMI and the
tenure when a floating rate rises, when a bullet / interest-only loan
matures, and whether a loan's EMI, balance and months left agree.

Sources (read 14 Oct 2026):

* RBI, "Reset of Floating Interest Rate on Equated Monthly Instalments (EMI)
  based Personal Loans", RBI/2023-24/55, DOR.MCS.REC.32/01.01.003/2023-24,
  18 Aug 2023 (updated 1 Oct 2025), para 2(iii): borrowers "shall also be
  given the choice to opt for (i) enhancement in EMI or elongation of tenor
  or for a combination of both options; and, (ii) to prepay"; para 2(v):
  "elongation of tenor ... does not result in negative amortisation".
  https://www.rbi.org.in/Scripts/NotificationUser.aspx?Id=12529
  The circular gives the borrower the choice; it does not say which one is
  the default. RightDue's default ("extend" for Indian floating loans) is a
  founder decision (Audit 80+ C1) that mirrors the usual bank practice of
  holding the EMI and lengthening the tenure.
* SBI home loan eligibility: "Loan Tenure: up to 30 years", "Max. Age: 70
  years" (https://sbi.co.in/web/yono/home-loan, last updated 19 Jul 2025).
  Used as the default ceiling on how far a home loan's tenure is extended
  when the user hasn't given their lender's own limit.
* Aavas Financiers, "Reset of Floating Interest Rate" (public notice under
  the 18 Aug 2023 circular, PDF dated 27 Nov 2025, read 15 Oct 2026):
  "effect of any change in AFL Prime Lending Rate shall be given on Tenor as
  default and if tenor exceeds 360 months, then EMI/PEMI shall increase".
  https://www.aavas.in/img/pdf/reset_of_floating_interest_rate_Aavas1.pdf
  An example of the Indian default the founder chose (round 2, 15 Oct 2026):
  tenure first, up to min(360 months, the lender's maximum, the months until
  the borrower reaches their retirement / age limit); past that the EMI
  rises. NOTE: Aavas counts the 360 months as the loan's whole tenor; the
  engine doesn't know when a loan started, so it counts from today (a
  VERIFY item: docs/FOUNDER-RECORDS.md row A13).
* RBI (Lending Against Gold and Silver Collateral) Directions, 2025,
  DOR.CRE.REC.26/21.01.023/2025-26, 6 Jun 2025 (updated 29 Sep 2025),
  para 6(i): "'Bullet Repayment Loans' means loans where both principal and
  interest are due for payment at the maturity of the loan"; para 15: the
  tenor of consumption bullet loans is "capped at 12 months, which may be
  renewed"; para 11: renewal of a bullet loan "only after payment of accrued
  interest". https://www.rbi.org.in/Scripts/NotificationUser.aspx?Id=12859
  A Lok Sabha answer of 6 Mar 2026 says these directions were subsumed into
  the consolidated "Credit Facilities" directions of 28 Nov 2025; the
  substance quoted above is unchanged as far as the audit checked.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from decimal import Decimal, ROUND_HALF_UP
from typing import Optional

from engine.formulas import emi, loan_market
from engine.models import Country, Loan, LoanType

D = Decimal

RBI_RESET_CIRCULAR_URL = "https://www.rbi.org.in/Scripts/NotificationUser.aspx?Id=12529"
RBI_GOLD_DIRECTIONS_URL = "https://www.rbi.org.in/Scripts/NotificationUser.aspx?Id=12859"
SBI_HOME_LOAN_URL = "https://sbi.co.in/web/yono/home-loan"
AAVAS_RESET_URL = "https://www.aavas.in/img/pdf/reset_of_floating_interest_rate_Aavas1.pdf"

RATE_RISE_MODES = ("extend", "raise_emi", "mix")
REPAYMENT_KINDS = ("emi", "interest_only", "bullet")

# Default ceiling on an Indian home loan's months left after a tenure-first
# extension: SBI's 30-year maximum tenure, counted from today because the
# engine doesn't know when the loan started or the borrower's age. A user who
# knows their lender's limit (or their age limit) sets Loan.max_tenure_months.
IN_HOME_MAX_TENURE_MONTHS = 360
# Round 2 (founder, 15 Oct 2026): no extension ever runs past 360 months,
# whatever a lender's own limit says.
ABSOLUTE_MAX_TENURE_MONTHS = 360
# Age by which a tenure-first extension must end when the user gave a date of
# birth but no retirement age: 60 for a salaried borrower (a common
# retirement age), 70 for anyone else (SBI's "Max. Age: 70 years" above).
# Founder defaults, editable per user (User.retirement_age). VERIFY.
DEFAULT_RETIREMENT_AGE = {"salaried": 60, "business_owner": 70}
DEFAULT_RETIREMENT_AGE_OTHER = 70

# A loan whose EMI, balance and months left imply a payoff more than this many
# months away from the months left the user typed gets a warning (Audit C3).
CONTRACT_MISMATCH_MONTHS = 2


# ── Rate rises (Audit C1) ────────────────────────────────────────────────────

def rate_rise_mode(loan: Loan, country: Country) -> str:
    """What happens to the EMI when this loan's rate rises.

    The loan's own `on_rate_rise` wins. Otherwise an Indian loan holds its
    EMI and lengthens its tenure ("extend", founder decision), and a US loan
    (an ARM re-amortises over the remaining term) raises its payment."""
    mode = (loan.on_rate_rise or "").strip().lower()
    if mode in RATE_RISE_MODES:
        return mode
    return "extend" if loan_market(loan, country) == Country.IN else "raise_emi"


def default_retirement_age(income_type) -> int:
    """60 for a salaried borrower, 70 for anyone else (founder default)."""
    key = getattr(income_type, "value", income_type)
    return DEFAULT_RETIREMENT_AGE.get(str(key or ""), DEFAULT_RETIREMENT_AGE_OTHER)


def months_until_age_limit(user, month: int = 1) -> Optional[int]:
    """Months from plan month `month` until the borrower reaches their
    retirement / age limit (the month they turn that age is the last one a
    loan may run). None when the date of birth isn't known."""
    if user is None or getattr(user, "age_months", None) is None:
        return None
    limit = user.retirement_age or default_retirement_age(user.income_type)
    return limit * 12 - user.age_months - max(0, month - 1)


def extension_cap(loan: Loan, months_left: int, country: Country,
                  age_months_left: Optional[int] = None) -> int:
    """Most months the loan may have left after a tenure extension.

    Founder rule (round 2, 15 Oct 2026): min(360 months, the lender's
    maximum, the months until the borrower reaches their retirement / age
    limit), each counted from the reset month; once the ceiling binds the
    EMI rises (reprice_on_rise). Which of the three are known:

    * the lender's limit (`Loan.max_tenure_months`, months from now) when
      the user typed it, capped at 360;
    * otherwise 360 for an Indian home loan (SBI's and Aavas's 30 years);
      any other loan isn't stretched past its contract unless the user says
      how far its lender allows (a floating personal loan or LAP rarely runs
      30 years; founder decision recorded in work/reports/w01.md);
    * `age_months_left` (months_until_age_limit) when the date of birth is
      known.

    Never below `months_left`: a ceiling that has already passed means no
    extension at all (the EMI rises to keep the end date)."""
    if loan.max_tenure_months is not None and loan.max_tenure_months > 0:
        cap = min(loan.max_tenure_months, ABSOLUTE_MAX_TENURE_MONTHS)
    elif loan.loan_type == LoanType.HOME and loan_market(loan, country) == Country.IN:
        cap = IN_HOME_MAX_TENURE_MONTHS
    else:
        cap = months_left
    if age_months_left is not None:
        cap = min(cap, age_months_left)
    return max(months_left, cap)


def months_to_clear(balance: Decimal, rate: Decimal, payment: Decimal) -> Optional[int]:
    """Months a fixed payment takes to clear `balance` at annual `rate`.
    None when the payment doesn't cover the interest."""
    if balance <= 0:
        return 0
    r = float(rate) / 12
    p, a = float(balance), float(payment)
    if a <= 0:
        return None
    if r == 0:
        return math.ceil(p / a)
    if a <= r * p:
        return None
    n = -math.log(1 - r * p / a) / math.log(1 + r)
    # A float path count of 228.0000001 for a loan with exactly 228 left.
    return max(1, math.ceil(n - 1e-6))


@dataclass(frozen=True)
class RepriceResult:
    emi: Decimal
    months_left: int
    capped: bool          # the extension ceiling bound, so the EMI rose


def reprice_on_rise(balance: Decimal, new_rate: Decimal, current_emi: Decimal,
                    months_left: int, mode: str, cap: int) -> RepriceResult:
    """The EMI and months left after a rate rise, for one mode.

    * raise_emi: re-amortise over the months left (the end date holds). An
      EMI that still clears in time (a prepayment head start) is kept.
    * extend: keep the EMI and lengthen the tenure; if that would run past
      `cap` (or the EMI no longer covers the interest, which RBI para 2(v)
      forbids), raise the EMI just enough to finish by `cap`.
    * mix: raise the EMI by half of what raise_emi would, then extend.
    """
    months_left = max(1, months_left)
    raise_to = emi(balance, new_rate, months_left)
    if mode == "raise_emi":
        if raise_to > current_emi:
            return RepriceResult(raise_to, months_left, False)
        return RepriceResult(current_emi, months_left, False)
    payment = current_emi
    if mode == "mix" and raise_to > current_emi:
        payment = current_emi + (raise_to - current_emi) / 2
    n = months_to_clear(balance, new_rate, payment)
    if n is not None and n <= cap:
        return RepriceResult(payment, max(months_left, n), False)
    return RepriceResult(max(payment, emi(balance, new_rate, cap)), cap, True)


def remaining_interest(balance: Decimal, rate: Decimal, payment: Decimal, months: int) -> Decimal:
    """Interest paid clearing `balance` with `payment` a month for at most
    `months` months, the last month paying whatever is left."""
    r = rate / D("12")
    bal = balance
    total = D("0")
    for k in range(1, max(1, months) + 1):
        i = bal * r
        total += i
        if k == months or payment >= bal + i:
            break
        bal = bal + i - payment
    return total.quantize(D("0.01"), rounding=ROUND_HALF_UP)


@dataclass
class RateRiseOption:
    mode: str
    emi: Decimal
    months_left: int
    total_interest: Decimal
    emi_change: Decimal          # vs the EMI before the rise
    months_change: int           # vs the months left before the rise
    capped: bool = False


@dataclass
class RateRiseOptions:
    """Both outcomes of one rate rise, side by side (Vijay, A13: "show impact
    and the most valuable step"), with the step RightDue recommends."""
    old_rate: Decimal
    new_rate: Decimal
    old_emi: Decimal
    months_left_before: int
    applied: str                         # the mode the plan used
    options: dict[str, RateRiseOption] = field(default_factory=dict)
    # "Keeping the EMI costs this much more interest than raising it."
    extra_interest_if_extended: Decimal = D("0")
    recommended: str = "extend"          # "extend" | "raise_emi" | "keep_emi_and_prepay"
    reason: str = ""
    # Inputs kept so the recommendation can be redone once the month's
    # spare cash is known (the simulator resets rates before it has it).
    balance: Decimal = D("0")
    cap: int = 0
    spare_cash: Optional[Decimal] = None


def rate_rise_options(balance: Decimal, old_rate: Decimal, new_rate: Decimal, current_emi: Decimal,
                      months_left: int, cap: int, applied: str,
                      spare_cash: Optional[Decimal] = None, prepay_fee: Decimal = D("0")) -> RateRiseOptions:
    """What each choice the borrower is owed at a reset does to this loan.

    `spare_cash` is the month's money left after every minimum (the plan's
    available surplus), when known. The recommendation:

    * the EMI rise fits the spare cash and prepaying is free (an Indian
      floating loan to an individual: RBI Pre-payment Charges Directions
      2025): keep the lower EMI and prepay the difference each month. It
      saves the same interest as raising the EMI while the contractual
      payment stays low, so a bad month needs no bank's permission;
    * it fits but prepaying costs a fee: raise the EMI;
    * it doesn't fit (or spare cash isn't known): extend the tenure, and say
      what the extra months cost;
    * the extension ceiling binds: the EMI has to rise either way.
    """
    out = RateRiseOptions(old_rate, new_rate, current_emi, months_left, applied,
                          balance=balance, cap=cap, spare_cash=spare_cash)
    for mode in RATE_RISE_MODES:
        rp = reprice_on_rise(balance, new_rate, current_emi, months_left, mode, cap if mode != "raise_emi" else months_left)
        out.options[mode] = RateRiseOption(
            mode=mode,
            emi=rp.emi.quantize(D("0.01"), rounding=ROUND_HALF_UP),
            months_left=rp.months_left,
            total_interest=remaining_interest(balance, new_rate, rp.emi, rp.months_left),
            emi_change=(rp.emi - current_emi).quantize(D("0.01"), rounding=ROUND_HALF_UP),
            months_change=rp.months_left - months_left,
            capped=rp.capped,
        )
    ext, rse = out.options["extend"], out.options["raise_emi"]
    out.extra_interest_if_extended = max(D("0"), ext.total_interest - rse.total_interest)
    rise = rse.emi_change
    if ext.capped and ext.emi_change > 0:
        out.recommended = "raise_emi"
        out.reason = ("The tenure can't stretch far enough (lender's maximum), so the EMI has to rise. "
                      "Raising it to finish on the original date costs the least interest.")
    elif rise <= 0:
        out.recommended = "extend"
        out.reason = "The EMI already clears the loan on time at the new rate, so nothing has to change."
    elif spare_cash is not None and spare_cash >= rise and prepay_fee <= 0:
        out.recommended = "keep_emi_and_prepay"
        out.reason = ("Keep the EMI and prepay the difference each month from spare cash: it saves the same "
                      "interest as a higher EMI, and the lower EMI stays the only amount you must pay in a "
                      "tight month.")
    elif spare_cash is not None and spare_cash >= rise:
        out.recommended = "raise_emi"
        out.reason = ("The higher EMI fits your spare cash and saves the extra interest that extending costs; "
                      "prepaying this loan carries a fee, so raise the EMI rather than prepay.")
    else:
        out.recommended = "extend"
        out.reason = ("Keep the EMI: a higher one doesn't fit this month's spare cash. The extra months cost "
                      "more interest; prepay when you can to win it back.")
    return out


# ── Repayment shape and maturity (Audit C2, C3, C6) ──────────────────────────

def repayment_kind(loan: Loan) -> str:
    """"emi" | "interest_only" | "bullet".

    The loan's own `repayment` wins. A gold loan with no EMI is a bullet
    (RBI gold directions para 6(i)); every other loan is an EMI loan. An
    interest-only loan must be marked (its EMI equals the month's interest,
    which an EMI loan with a typo can also show)."""
    kind = (loan.repayment or "").strip().lower()
    if kind in REPAYMENT_KINDS:
        return kind
    if loan.loan_type == LoanType.GOLD and loan.scheduled_emi <= 0 and loan.tenure_months_remaining > 0:
        return "bullet"
    return "emi"


def has_contract_end(loan: Loan) -> bool:
    """True when the loan must be repaid in full by its last contractual
    month: any non-card loan with a known tenure, except a US federal
    student loan on a forgiveness track (what's left then is forgiven)."""
    if loan.loan_type == LoanType.CREDIT_CARD:
        return False
    if loan.tenure_months_remaining <= 0:
        return False
    if getattr(loan, "forgiveness_track", None):
        return False
    return True


def implied_months(balance: Decimal, rate: Decimal, payment: Decimal) -> Optional[int]:
    """Months the EMI takes to clear the balance (None: it never does)."""
    return months_to_clear(balance, rate, payment)


def implied_reducing_rate(balance: Decimal, payment: Decimal, months: int) -> Optional[Decimal]:
    """The yearly reducing-balance rate at which `payment` a month for
    `months` months clears `balance`. None when no rate in [0, 1000%] does
    (the payments don't even cover the balance)."""
    if balance <= 0 or payment <= 0 or months <= 0:
        return None
    if payment * months < balance:
        return None
    lo, hi = D("0"), D("10")
    if emi(balance, hi, months) < payment:
        return None
    for _ in range(80):
        mid = (lo + hi) / 2
        if emi(balance, mid, months) < payment:
            lo = mid
        else:
            hi = mid
    return ((lo + hi) / 2).quantize(D("0.000001"), rounding=ROUND_HALF_UP)


def contract_mismatch(loan: Loan) -> Optional[str]:
    """A plain warning when the EMI, the balance and the months left don't
    agree (Audit C3), else None. The plan still runs: the last contractual
    month then pays whatever is left (a balloon), as a lender would ask."""
    if not has_contract_end(loan) or loan.outstanding <= 0:
        return None
    kind = repayment_kind(loan)
    if kind != "emi" or loan.scheduled_emi <= 0 or loan.pre_emi_months_remaining > 0:
        return None
    n = implied_months(loan.outstanding, loan.nominal_rate, loan.scheduled_emi)
    left = loan.tenure_months_remaining
    if n is None:
        return (f"These don't match: the EMI doesn't cover the interest, so it never clears the balance, "
                f"but you said {left} month{'s' if left != 1 else ''} are left. The plan treats the last month "
                "as a balloon of whatever is still owed; check the EMI and the months left.")
    if abs(n - left) > CONTRACT_MISMATCH_MONTHS:
        if n > left:
            return (f"These don't match: this EMI clears the balance in {n} months, but you said {left} "
                    f"{'is' if left == 1 else 'are'} left. The plan pays the rest as a lump sum in month {left}, "
                    "as your lender would ask at maturity; check the EMI and the months left.")
        return (f"These don't match: this EMI clears the balance in {n} months, sooner than the {left} you said "
                "are left. The plan follows the EMI; check the EMI and the months left.")
    return None
