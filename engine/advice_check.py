"""Check advice someone pasted against the user's own loans and RBI rules (A8).

"Got advice from an assistant or a bank RM? Paste it and we'll check it."

Every assistant words its answer differently, and two assistants can give
different answers to the same question. So this never compares one text
with another and never asks a model what it thinks. It does three
deterministic things:

1. **Pull out checkable claims.** The text is cut into sentences; each one is
   read with fixed patterns for the claims that money advice is made of: a
   loan's interest rate, an EMI, which loan to pay first (by name or by rule:
   "highest interest first", "smallest balance first"), whether prepaying
   costs a fee, reduce-tenure vs reduce-EMI, minimum-due on a card,
   moving card debt to a cheaper loan, invest-instead-of-prepay, and the
   repo rate. Indian money formats are read as written (₹1,23,456,
   Rs 50 lakh, 1.2 cr, 12k) and loans are recognised by kind and by the
   lender names the user entered ("the HDFC card", "your car loan").
2. **Recompute each claim from the user's numbers.** Rates against the rates
   they entered; EMIs with the same EMI formula as the plan
   (engine.formulas.emi); payoff order against the order the plan actually
   uses this month; prepayment fees against RBI's rule; repo against the
   policy-rate table the rest of the app uses.
3. **Say agree, disagree or can't check, with the reason.** A sentence that
   matches no pattern is listed as "not checked", never guessed at.

Same text in, same verdicts out: no model, no network, nothing stored.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation
from typing import Optional

from engine import policy_rates
from engine.citations import PREPAYMENT_NO_CHARGE
from engine.formulas import emi as emi_of
from engine.models import Country

D = Decimal
MAX_TEXT = 8000
MAX_CLAIMS = 30
# How close counts as "the same": rates within 0.10 percentage points (a
# rounded quote), EMIs within 1% or ₹100 (rounding, insurance add-ons).
RATE_TOLERANCE = D("0.0010")
EMI_TOLERANCE_PCT = D("0.01")
EMI_TOLERANCE_ABS = D("100")
# engine/goals.py HIGH_APR_THRESHOLD: what the plan calls high-interest.
HIGH_RATE = {"IN": D("0.12"), "US": D("0.10")}

AGREE, DISAGREE, CANT = "agree", "disagree", "cant_check"


@dataclass(frozen=True)
class AdviceLoan:
    loan_type: str                       # engine LoanType value
    outstanding: Decimal
    rate: Optional[Decimal]              # annual decimal
    emi: Optional[Decimal] = None
    months_left: Optional[int] = None
    rate_type: str = "floating"
    bank: str = ""


@dataclass(frozen=True)
class PlanFacts:
    """What the plan says this month (from the same engine run as Home)."""
    extra_target: Optional[int] = None   # index into loans that gets the extra
    strategy: str = "avalanche"
    country: str = "IN"
    regime: Optional[str] = None         # "old" | "new" | None (unknown)
    today: Optional[date] = None


@dataclass
class Claim:
    kind: str
    quote: str
    verdict: str
    why: str
    theirs: Optional[str] = None
    ours: Optional[str] = None
    loan: Optional[int] = None
    source: Optional[str] = None


@dataclass
class Report:
    claims: list[Claim] = field(default_factory=list)
    not_checked: list[str] = field(default_factory=list)

    @property
    def counts(self) -> dict[str, int]:
        c = {AGREE: 0, DISAGREE: 0, CANT: 0}
        for x in self.claims:
            c[x.verdict] += 1
        return c

    @property
    def headline(self) -> str:
        c = self.counts
        if not self.claims:
            return ("We couldn't find a claim we can check (a rate, an EMI, which loan to pay first, "
                    "prepayment fees). Paste the part with numbers or a recommendation.")
        if c[DISAGREE] == 0:
            return f"We checked {len(self.claims)} claim{'s' if len(self.claims) != 1 else ''}: none disagree with your numbers."
        return (f"We checked {len(self.claims)} claim{'s' if len(self.claims) != 1 else ''}: "
                f"{c[DISAGREE]} disagree{'s' if c[DISAGREE] == 1 else ''} with your loans or RBI's rules.")


# ── names for loans ─────────────────────────────────────────────────────────

KIND_WORDS: dict[str, re.Pattern[str]] = {
    "home_loan": re.compile(r"\b(home|housing|house)[\s-]+loans?\b|\bmortgages?\b|\blap\b|\bloan\s+against\s+property\b"),
    "auto_loan": re.compile(r"\b(car|auto|vehicle|bike|two[\s-]?wheeler)[\s-]+loans?\b"),
    "personal_loan": re.compile(r"\bpersonal[\s-]+loans?\b|\bpl\b"),
    "credit_card": re.compile(r"\bcredit[\s-]+cards?\b|\bcards?\b(?![\s-]+(?:holder|number))"),
    "education_loan": re.compile(r"\b(education|student|study)[\s-]+loans?\b"),
    "gold_loan": re.compile(r"\bgold[\s-]+loans?\b"),
    "bnpl": re.compile(r"\bbnpl\b|\bbuy\s+now,?\s+pay\s+later\b|\bpay[\s-]?later\b|\blazypay\b|\bsimpl\b"),
}
TYPE_LABEL = {
    "home_loan": "home loan", "auto_loan": "car loan", "personal_loan": "personal loan",
    "credit_card": "credit card", "education_loan": "education loan", "gold_loan": "gold loan",
    "bnpl": "pay-later loan", "loan_against_property": "loan against property", "home_topup": "home loan top-up",
    "two_wheeler_loan": "two-wheeler loan", "medical_loan": "medical loan",
    "people_loan": "loan from a person",
}


def label(loans: list[AdviceLoan], i: int) -> str:
    l = loans[i]
    t = TYPE_LABEL.get(l.loan_type, "loan")
    return f"{l.bank} {t}".strip() if l.bank else f"your {t}"


def _cap(s: str) -> str:
    return s[:1].upper() + s[1:]


def _norm(s: str) -> str:
    return " " + re.sub(r"\s+", " ", s.lower().replace("’", "'")) + " "


def mentioned_loans(sentence: str, loans: list[AdviceLoan]) -> list[int]:
    """Loans a sentence talks about, in the order they're first mentioned."""
    s = _norm(sentence)
    hits: list[tuple[int, int]] = []
    for i, l in enumerate(loans):
        pos = -1
        bank = l.bank.strip().lower()
        pat = KIND_WORDS.get(l.loan_type)
        km = pat.search(s) if pat else None
        kind_pos = km.start() if km else -1
        bm = re.search(r"\b" + re.escape(bank) + r"\b", s) if len(bank) >= 2 else None
        bank_pos = bm.start() if bm else -1
        same_kind = sum(1 for x in loans if x.loan_type == l.loan_type)
        if same_kind > 1:
            # Two cards: the lender's name decides which one.
            if bank_pos >= 0:
                pos = bank_pos
            elif kind_pos >= 0 and not any(
                    len(x.bank) >= 2 and re.search(r"\b" + re.escape(x.bank.lower()) + r"\b", s)
                    for x in loans if x.loan_type == l.loan_type):
                pos = kind_pos           # "your cards": every card
        else:
            pos = kind_pos if kind_pos >= 0 else bank_pos
        if pos >= 0:
            hits.append((pos, i))
    return [i for _, i in sorted(hits)]


# ── numbers in text ─────────────────────────────────────────────────────────

_MULT = {"lakh": D("100000"), "lakhs": D("100000"), "lac": D("100000"), "lacs": D("100000"), "l": D("100000"),
         "crore": D("10000000"), "crores": D("10000000"), "cr": D("10000000"),
         "k": D("1000"), "thousand": D("1000")}
_MONEY = re.compile(
    r"(?:(?P<cur>₹|rs\.?|inr|\$|usd)\s*(?P<a>\d[\d,]*(?:\.\d+)?)\s*(?P<m1>lakhs?|lacs?|crores?|cr|k|thousand|l)?\b"
    r"|(?P<b>\d[\d,]*(?:\.\d+)?)\s*(?P<m2>lakhs?|lacs?|crores?|cr|k|thousand)\b)",
    re.I,
)
_PCT = re.compile(r"(?<![\d.])(?P<n>\d{1,3}(?:\.\d{1,3})?)\s*(?:%|per\s?cent\b|pc\b|percent\b)", re.I)
_TENURE = re.compile(r"(?P<n>\d{1,3}(?:\.\d)?)\s*(?:-|\s)?(?P<u>years?|yrs?|months?|mos?)\b", re.I)


def money(s: str) -> list[tuple[int, Decimal]]:
    out = []
    for m in _MONEY.finditer(s):
        raw = (m.group("a") or m.group("b") or "").replace(",", "")
        mult = (m.group("m1") or m.group("m2") or "").lower()
        try:
            v = D(raw) * _MULT.get(mult, D(1))
        except InvalidOperation:
            continue
        if v > 0:
            out.append((m.start(), v))
    return out


def percents(s: str) -> list[tuple[int, Decimal]]:
    return [(m.start(), D(m.group("n")) / 100) for m in _PCT.finditer(s)]


def tenure_months(s: str) -> Optional[int]:
    m = _TENURE.search(s)
    if not m:
        return None
    n = D(m.group("n"))
    return int((n * 12 if m.group("u").lower().startswith("y") else n).to_integral_value())


def sentences(text: str) -> list[str]:
    t = re.sub(r"[ \t]+", " ", text[:MAX_TEXT])
    # Split on . ! ? followed by space/end (not "8.5"), on new lines and bullets.
    parts = re.split(r"(?<=[.!?])\s+(?=[A-Z0-9₹(\"'*•-])|\n+|(?:^|\s)[•*]\s|(?:^|\n)\s*\d+[.)]\s", t)
    return [p.strip(" -*•\t") for p in parts if p and len(p.strip(" -*•\t")) > 3]


# ── formatting ──────────────────────────────────────────────────────────────

def pct(x: Decimal) -> str:
    q = (D(x) * 100).quantize(D("0.01"), rounding=ROUND_HALF_UP)
    return f"{q.normalize():f}%"


def rupees(x: Decimal, country: str = "IN") -> str:
    v = int(D(x).quantize(D("1"), rounding=ROUND_HALF_UP))
    if country == "US":
        return f"${v:,}"
    s = str(abs(v))
    if len(s) > 3:
        head, tail = s[:-3], s[-3:]
        groups = []
        while len(head) > 2:
            groups.insert(0, head[-2:])
            head = head[:-2]
        if head:
            groups.insert(0, head)
        s = ",".join(groups) + "," + tail
    return ("-" if v < 0 else "") + "₹" + s


def _quote(s: str) -> str:
    return s if len(s) <= 220 else s[:217] + "…"


# ── the checks ──────────────────────────────────────────────────────────────

_ORDER = re.compile(
    r"\b(pay(?:ing)?\s+off|clear(?:ing)?|close|prioriti[sz]e|focus(?:ing)?\s+on|tackle|attack|target|"
    r"go\s+after|knock\s+out|kill)\b|\b(put|throw|direct|send|use)\b[^.]{0,40}\b(extra|surplus|spare|bonus|"
    r"additional)\b",
    re.I,
)
_FIRST = re.compile(r"\b(first|priority|before|top\s+priority|start\s+with|immediately|asap)\b", re.I)
_AVALANCHE = re.compile(r"\b(highest[\s-]+(?:interest|rate|apr)|avalanche|costliest|most\s+expensive)\b", re.I)
_SNOWBALL = re.compile(r"\b(smallest[\s-]+(?:balance|loan|debt)|snowball|lowest\s+balance)\b", re.I)
_FEE = re.compile(r"\b(penalt(?:y|ies)|fore-?closure\s+(?:charge|fee)s?|pre-?payment\s+(?:charge|fee|penalty)s?|"
                  r"pre-?closure\s+(?:charge|fee)s?|part-?payment\s+(?:charge|fee)s?)\b", re.I)
_NO_FEE = re.compile(r"\b(no|zero|without|free\s+of|nil|not\s+(?:charge|levy|allowed\s+to\s+charge)|can't\s+charge|"
                     r"cannot\s+charge|won't\s+charge|waived)\b", re.I)
_EMI = re.compile(r"\b(emi|monthly\s+(?:payment|instal?ment)|instal?ment)s?\b", re.I)
_TENURE_ROUTE = re.compile(r"\b(reduce|lower|cut|shorten)\w*\s+(?:the\s+|your\s+)?(tenure|term|tenor)\b", re.I)
_EMI_ROUTE = re.compile(r"\b(reduce|lower|cut)\w*\s+(?:the\s+|your\s+)?emi\b", re.I)
_MIN_DUE = re.compile(r"\bminimum\s+(?:due|amount|payment)\b|\bminimum\b(?=[^.]{0,30}\bcards?\b)|\bcards?\b[^.]{0,40}\bminimum\b", re.I)
_ONLY = re.compile(r"\b(only|just)\b", re.I)
_MORE_THAN = re.compile(r"\b(more\s+than|above|over|beyond)\s+(?:the\s+)?minimum", re.I)
_CONSOLIDATE = re.compile(r"\b(consolidat\w*|balance\s+transfer|refinanc\w*|take\s+a\s+personal\s+loan|"
                          r"personal\s+loan\s+to\s+(?:pay|clear|close))\b", re.I)
_INVEST = re.compile(r"\b(invest\w*|sip|mutual\s+funds?|index\s+funds?|stocks?|equity|nifty)\b", re.I)
_INSTEAD = re.compile(r"\b(instead\s+of|rather\s+than|than|don't|do\s+not|avoid|no\s+need\s+to)\b[^.]{0,30}"
                      r"\b(pre-?pay\w*|pay(?:ing)?\s+(?:off|down)|clos\w+)", re.I)
_REPO = re.compile(r"\brepo\b", re.I)
_TAX = re.compile(r"\b(tax|24\s*\(?b\)?|80c|deduction)\b", re.I)
_PREPAY = re.compile(r"\b(pre-?pay\w*|part-?pay\w*|pay(?:ing)?\s+(?:it\s+)?(?:off|down)|fore-?clos\w*)\b", re.I)
_DONT = re.compile(r"\b(don't|do\s+not|avoid|shouldn't|should\s+not|no\s+need\s+to|never)\b", re.I)
_RATE_WORD = re.compile(r"\b(at|@|rate|interest|charg\w+|apr|p\.?a\.?|costs?)\b|@", re.I)
_NOT_LOAN_RATE = re.compile(r"\b(return|returns|fd|fixed\s+deposit|inflation|yield|sip|cagr|gst|tax\s+slab|bracket|"
                            r"repo|savings\s+account|growth|hike|cut|raise|increase|rise|drop)\b", re.I)


def _rate_claims(s: str, loans: list[AdviceLoan], idx: list[int], p: PlanFacts) -> list[Claim]:
    out = []
    if not idx or _EMI.search(s) or _NOT_LOAN_RATE.search(s) or not _RATE_WORD.search(s):
        return out
    pcs = percents(s)
    if len(pcs) != 1 or len(idx) != 1:
        return out              # several rates and loans in one line: can't pair them safely
    i = idx[0]
    l = loans[i]
    theirs = pcs[0][1]
    if l.rate is None:
        out.append(Claim("rate", _quote(s), CANT, f"You haven't entered a rate for {label(loans, i)}.",
                         pct(theirs), None, i))
    elif abs(theirs - l.rate) <= RATE_TOLERANCE:
        out.append(Claim("rate", _quote(s), AGREE, f"Matches the {pct(l.rate)} you entered for {label(loans, i)}.",
                         pct(theirs), pct(l.rate), i))
    else:
        out.append(Claim("rate", _quote(s), DISAGREE,
                         f"You entered {pct(l.rate)} for {label(loans, i)}, not {pct(theirs)}. Advice built on the "
                         f"wrong rate can put money on the wrong loan.", pct(theirs), pct(l.rate), i))
    return out


def _expected_emi(l: AdviceLoan, principal: Optional[Decimal], rate: Optional[Decimal], n: Optional[int]) -> Optional[Decimal]:
    P = principal if principal is not None else l.outstanding
    r = rate if rate is not None else l.rate
    if n is None and principal is None and rate is None and l.emi:
        return l.emi
    n = n if n is not None else l.months_left
    if r is None or not n:
        return None
    return emi_of(D(P), D(r), int(n))


def _emi_claims(s: str, loans: list[AdviceLoan], idx: list[int], p: PlanFacts) -> list[Claim]:
    m = _EMI.search(s)
    if not m:
        return []
    amounts = money(s)
    if not amounts:
        return []
    if len(idx) > 1:
        return []
    # The EMI is the amount nearest after the word "EMI" (else nearest before);
    # an amount over 12 EMIs is the principal.
    emi_pos = m.start()
    after = [a for a in amounts if a[0] > emi_pos]
    theirs_pos, theirs = min(after or amounts, key=lambda a: abs(a[0] - emi_pos))
    others = [v for pos, v in amounts if pos != theirs_pos and v > theirs * 12]
    principal = max(others) if others else None
    if principal is not None and theirs > principal:
        return []
    pcs = percents(s)
    rate = pcs[0][1] if len(pcs) == 1 else None
    n = tenure_months(s)
    if not idx and len(loans) != 1:
        if principal is None or rate is None or n is None:
            return []
        # No loan named, but the sentence has everything: plain arithmetic.
        want = emi_of(principal, rate, n)
        how = f"the standard EMI formula for {rupees(principal, p.country)} at {pct(rate)} over {n} months"
        ok = abs(theirs - want) <= max(EMI_TOLERANCE_ABS, want * EMI_TOLERANCE_PCT)
        return [Claim("emi", _quote(s), AGREE if ok else DISAGREE,
                      f"Matches {how}: {rupees(want, p.country)}." if ok else
                      f"By {how} it's {rupees(want, p.country)} a month, not {rupees(theirs, p.country)}.",
                      rupees(theirs, p.country), rupees(want, p.country))]
    i = idx[0] if idx else 0
    l = loans[i]
    want = _expected_emi(l, principal, rate, n)
    if want is None:
        return [Claim("emi", _quote(s), CANT, f"We need the rate and months left on {label(loans, i)} to check an EMI.",
                      rupees(theirs, p.country), None, i)]
    basis = []
    if principal is not None:
        basis.append(f"{rupees(principal, p.country)} borrowed")
    else:
        basis.append(f"{rupees(l.outstanding, p.country)} owed")
    if rate is not None or l.rate is not None:
        basis.append(f"at {pct(rate if rate is not None else l.rate)}")
    if n is not None or (l.months_left and not (principal is None and rate is None and l.emi)):
        basis.append(f"over {n or l.months_left} months")
    how = ("the EMI you entered" if (n is None and principal is None and rate is None and l.emi)
           else "the standard EMI formula for " + " ".join(basis))
    tol = max(EMI_TOLERANCE_ABS, want * EMI_TOLERANCE_PCT)
    if abs(theirs - want) <= tol:
        return [Claim("emi", _quote(s), AGREE, f"Matches {how}: {rupees(want, p.country)}.",
                      rupees(theirs, p.country), rupees(want, p.country), i)]
    return [Claim("emi", _quote(s), DISAGREE,
                  f"By {how} it's {rupees(want, p.country)} a month, not {rupees(theirs, p.country)}.",
                  rupees(theirs, p.country), rupees(want, p.country), i)]


def _rule_target(loans: list[AdviceLoan], rule: str) -> Optional[int]:
    open_ = [(i, l) for i, l in enumerate(loans) if l.outstanding > 0]
    if not open_:
        return None
    if rule == "avalanche":
        rated = [(i, l) for i, l in open_ if l.rate is not None]
        return max(rated, key=lambda t: (t[1].rate, -t[1].outstanding))[0] if rated else None
    return min(open_, key=lambda t: (t[1].outstanding, -(t[1].rate or 0)))[0]


def _order_claims(s: str, loans: list[AdviceLoan], idx: list[int], p: PlanFacts) -> list[Claim]:
    rule = "avalanche" if _AVALANCHE.search(s) else "snowball" if _SNOWBALL.search(s) else None
    verb = _ORDER.search(s)
    if not (verb or rule):
        return []
    if _DONT.search(s[: verb.start()] if verb else s) and not rule:
        return []               # "don't close your card" is not an order claim
    target: Optional[int] = None
    if rule and (verb or _FIRST.search(s)):
        target = _rule_target(loans, rule)
        how = "highest rate first" if rule == "avalanche" else "smallest balance first"
    elif verb and (_FIRST.search(s) or re.search(r"\b(extra|surplus|spare|bonus|additional)\b", s, re.I)):
        after = [i for i in mentioned_loans(s[verb.start():], loans)]
        target = after[0] if after else (idx[0] if idx else None)
        how = None
    else:
        return []
    if target is None:
        return []
    ours = p.extra_target
    theirs_l, theirs_rate = label(loans, target), loans[target].rate
    if ours is None or not (0 <= ours < len(loans)):
        return [Claim("order", _quote(s), CANT,
                      "Your plan has no extra money to direct this month, so there's no order to compare.",
                      theirs_l, None, target)]
    if ours == target:
        extra = f" ({how})" if how else ""
        return [Claim("order", _quote(s), AGREE,
                      f"Your plan also puts this month's extra on {label(loans, ours)}{extra}.",
                      theirs_l, label(loans, ours), target)]
    our_rate = loans[ours].rate
    why = f"Your plan puts this month's extra on {label(loans, ours)}"
    if our_rate is not None and theirs_rate is not None and our_rate > theirs_rate:
        why += (f": it charges {pct(our_rate)} against {pct(theirs_rate)} on {theirs_l}, so each rupee there "
                f"saves more interest.")
    elif rule == "snowball":
        why += (f". Smallest balance first is a motivation rule; it costs more interest when a bigger loan "
                f"charges more.")
    else:
        why += f" ({p.strategy} order, after minimums and any lock-ins or fees on your loans)."
    return [Claim("order", _quote(s), DISAGREE, why, theirs_l, label(loans, ours), target)]


def _fee_claims(s: str, loans: list[AdviceLoan], idx: list[int], p: PlanFacts) -> list[Claim]:
    if p.country != "IN" or not _FEE.search(s):
        return []
    cands = idx or [i for i, l in enumerate(loans) if l.loan_type in ("home_loan", "auto_loan", "education_loan",
                                                                    "personal_loan", "gold_loan")]
    if len(cands) != 1:
        cands = [i for i in cands if loans[i].loan_type == "home_loan"][:1] or cands[:1]
    if not cands:
        return []
    i = cands[0]
    l = loans[i]
    says_free = bool(_NO_FEE.search(s))
    if l.rate_type != "floating" or l.loan_type in ("credit_card", "bnpl"):
        what = ("is a card or pay-later line, not a term loan" if l.loan_type in ("credit_card", "bnpl")
                else "is fixed-rate")
        return [Claim("prepay_fee", _quote(s), CANT,
                      f"{_cap(label(loans, i))} {what}: any prepayment fee is whatever your loan "
                      f"agreement says (the key facts statement lists it).", None, None, i)]
    rule = PREPAYMENT_NO_CHARGE
    if says_free:
        return [Claim("prepay_fee", _quote(s), AGREE,
                      "RBI: no prepayment or foreclosure charge on a floating-rate loan taken by an individual "
                      "for a non-business purpose, part or full, from any source.", "no fee", "no fee", i, rule.rule)]
    return [Claim("prepay_fee", _quote(s), DISAGREE,
                  f"{_cap(label(loans, i))} is floating-rate. RBI bars prepayment and foreclosure charges "
                  f"on an individual's floating-rate loan for a non-business purpose, part or full.",
                  "a fee applies", "no fee", i, rule.rule)]


def _sample_prepay(l: AdviceLoan, amount: Decimal) -> Optional[tuple[Decimal, Decimal, int]]:
    """Interest saved by a prepayment taken as shorter tenure vs lower EMI."""
    from engine.rate_move import amortise
    if l.rate is None or l.outstanding <= amount:
        return None
    e = l.emi or (emi_of(l.outstanding, l.rate, l.months_left) if l.months_left else None)
    if not e:
        return None
    base = amortise(l.outstanding, l.rate, e)
    if base.months is None:
        return None
    left = l.outstanding - amount
    tenure = amortise(left, l.rate, e)
    lower = amortise(left, l.rate, emi_of(left, l.rate, base.months))
    if tenure.interest is None or lower.interest is None or tenure.months is None:
        return None
    return base.interest - tenure.interest, base.interest - lower.interest, base.months - tenure.months


def _route_claims(s: str, loans: list[AdviceLoan], idx: list[int], p: PlanFacts) -> list[Claim]:
    t, e = _TENURE_ROUTE.search(s), _EMI_ROUTE.search(s)
    if not (t or e):
        return []
    favours_tenure = bool(t) and (not e or (t.start() < e.start() and re.search(
        r"\b(instead|rather|not|than)\b", s[t.end():], re.I) is not None) or not e)
    if t and e and not re.search(r"\b(instead|rather|not|than|over)\b", s, re.I):
        return []
    cands = idx or [i for i, l in enumerate(loans) if l.loan_type == "home_loan"] or list(range(len(loans)))
    cands = [i for i in cands if loans[i].loan_type not in ("credit_card", "bnpl")]
    if not cands:
        return []
    i = max(cands, key=lambda k: loans[k].outstanding)
    l = loans[i]
    amount = D("100000") if p.country == "IN" else D("1000")
    sample = _sample_prepay(l, amount)
    if sample is None:
        num = ""
    else:
        st, se, months = sample
        num = (f" On {label(loans, i)}, prepaying {rupees(amount, p.country)} saves {rupees(st, p.country)} of "
               f"interest as a shorter tenure ({months} months sooner) vs {rupees(se, p.country)} as a lower EMI.")
    if favours_tenure:
        return [Claim("tenure_vs_emi", _quote(s), AGREE,
                      "Keeping the EMI and cutting the tenure saves more interest." + num, "reduce tenure",
                      "reduce tenure", i)]
    return [Claim("tenure_vs_emi", _quote(s), DISAGREE,
                  "A lower EMI frees cash each month but saves less interest than a shorter tenure; choose it only "
                  "if you need the monthly room." + num, "reduce EMI", "reduce tenure", i)]


def _min_due_claims(s: str, loans: list[AdviceLoan], idx: list[int], p: PlanFacts) -> list[Claim]:
    if not _MIN_DUE.search(s):
        return []
    cards = [i for i, l in enumerate(loans) if l.loan_type == "credit_card" and l.outstanding > 0]
    if not cards:
        return []
    i = next((k for k in idx if k in cards), max(cards, key=lambda k: loans[k].rate or 0))
    r = loans[i].rate
    rate_bit = f" at {pct(r)} a year" if r is not None else ""
    if _MORE_THAN.search(s):
        return [Claim("minimum_due", _quote(s), AGREE,
                      f"Paying more than the minimum on {label(loans, i)} cuts interest charged{rate_bit} on the "
                      f"whole unpaid balance.", None, None, i)]
    if _ONLY.search(s) and not _DONT.search(s):
        return [Claim("minimum_due", _quote(s), DISAGREE,
                      f"Paying only the minimum keeps interest{rate_bit} running on the rest of {label(loans, i)}; "
                      f"pay the minimum on every card, then put the extra where your plan says.", None, None, i)]
    if _DONT.search(s) and _ONLY.search(s):
        return [Claim("minimum_due", _quote(s), AGREE,
                      f"Right: the minimum alone leaves interest{rate_bit} on the rest of {label(loans, i)}.",
                      None, None, i)]
    return [Claim("minimum_due", _quote(s), AGREE,
                  "Always pay at least the minimum on every card: a missed one is reported to the credit bureaus.",
                  None, None, i)]


def _consolidate_claims(s: str, loans: list[AdviceLoan], idx: list[int], p: PlanFacts) -> list[Claim]:
    if not _CONSOLIDATE.search(s):
        return []
    cards = [l for l in loans if l.loan_type in ("credit_card", "bnpl") and l.outstanding > 0 and l.rate is not None]
    if not cards:
        return []
    pcs = percents(s)
    owed = sum((l.outstanding for l in cards), D(0))
    blended = sum((l.outstanding * l.rate for l in cards), D(0)) / owed
    if len(pcs) != 1:
        return [Claim("consolidate", _quote(s), CANT,
                      f"Moving card debt to a loan only pays if the new rate, with its processing fee, is well "
                      f"under what your cards charge ({pct(blended)} blended on {rupees(owed, p.country)}). The "
                      f"advice doesn't give a rate to check.", None, pct(blended))]
    new = pcs[0][1]
    if new < blended:
        save = (blended - new) * owed
        return [Claim("consolidate", _quote(s), AGREE,
                      f"{pct(new)} is under your cards' {pct(blended)} blended rate: about {rupees(save, p.country)} "
                      f"less interest a year on {rupees(owed, p.country)}, before the processing fee. Only if the "
                      f"cards aren't run up again.", pct(new), pct(blended))]
    return [Claim("consolidate", _quote(s), DISAGREE,
                  f"{pct(new)} is not cheaper than your cards' {pct(blended)} blended rate.", pct(new), pct(blended))]


def _invest_claims(s: str, loans: list[AdviceLoan], idx: list[int], p: PlanFacts) -> list[Claim]:
    if not (_INVEST.search(s) and _INSTEAD.search(s)):
        return []
    rated = [(i, l) for i, l in enumerate(loans) if l.rate is not None and l.outstanding > 0]
    if not rated:
        return []
    i, top = max(rated, key=lambda t: t[1].rate)
    limit = HIGH_RATE.get(p.country, HIGH_RATE["IN"])
    if top.rate >= limit:
        return [Claim("invest_vs_prepay", _quote(s), DISAGREE,
                      f"{_cap(label(loans, i))} charges {pct(top.rate)}: paying it down is a sure "
                      f"{pct(top.rate)} saving, which an uncertain market return has to beat after tax. Clear "
                      f"high-interest debt first.", None, pct(top.rate), i)]
    return [Claim("invest_vs_prepay", _quote(s), CANT,
                  f"Your costliest loan is {pct(top.rate)}. Whether investing beats prepaying at that rate depends "
                  f"on your tax, your emergency fund and the risk you can take; RightDue doesn't recommend "
                  f"investments.", None, pct(top.rate), i)]


def _repo_claims(s: str, loans: list[AdviceLoan], idx: list[int], p: PlanFacts) -> list[Claim]:
    if p.country != "IN" or not _REPO.search(s):
        return []
    pcs = percents(s)
    today = p.today or date.today()
    current = policy_rates.rate_on(Country.IN, today)
    if current is None or len(pcs) != 1:
        return []
    theirs = pcs[0][1]
    if re.search(r"\b(cut|reduc|lower|hike|rais|increas)\w*\s+(?:by|of)\b", s, re.I):
        return []               # "cut by 0.25%" is a change, not a level
    hist = [(d, r) for d, r in policy_rates.history(Country.IN) if d <= today]
    when = hist[-1][0] if hist else today
    if abs(theirs - current) <= D("0.0001"):
        return [Claim("repo", _quote(s), AGREE, f"The repo rate is {pct(current)} (since {when:%d %b %Y}).",
                      pct(theirs), pct(current))]
    return [Claim("repo", _quote(s), DISAGREE,
                  f"The RBI repo rate is {pct(current)} since {when:%d %b %Y}, not {pct(theirs)}. Advice written "
                  f"before that move may be out of date.", pct(theirs), pct(current))]


# Old-regime cap on self-occupied home-loan interest: ₹2,00,000 a year
# (Income-tax Act 2025 s.22(2)(a), 1961 s.24(b)); nothing in the new regime
# (s.202(2)(a)(v), 1961 s.115BAC). Same figures as engine.formulas.country_cap_home_loan.
SELF_OCCUPIED_CAP_OLD = D("200000")


def _tax_claims(s: str, loans: list[AdviceLoan], idx: list[int], p: PlanFacts) -> list[Claim]:
    if p.country != "IN" or not (_TAX.search(s) and _PREPAY.search(s) and _DONT.search(s)):
        return []
    homes = [i for i in (idx or range(len(loans))) if loans[i].loan_type == "home_loan" and loans[i].rate is not None]
    if not homes:
        return []
    i = homes[0]
    l = loans[i]
    yearly = l.outstanding * l.rate
    if p.regime == "new":
        return [Claim("tax_prepay", _quote(s), DISAGREE,
                      "In the new tax regime, interest on a self-occupied home loan gives no deduction, so there's "
                      "no tax benefit to keep by not prepaying (a let-out house is different).", None, None, i)]
    if yearly > SELF_OCCUPIED_CAP_OLD:
        return [Claim("tax_prepay", _quote(s), DISAGREE if p.regime == "old" else CANT,
                      f"{_cap(label(loans, i))} charges about {rupees(yearly)} of interest a year. The old "
                      f"regime's deduction stops at {rupees(SELF_OCCUPIED_CAP_OLD)} for a self-occupied home, so "
                      f"prepaying loses no deduction until the yearly interest falls below that"
                      + ("." if p.regime == "old" else ", if you're in the old regime and live in the house."),
                      None, rupees(yearly), i)]
    return [Claim("tax_prepay", _quote(s), CANT,
                  f"Your yearly home-loan interest (about {rupees(yearly)}) is under the old regime's "
                  f"{rupees(SELF_OCCUPIED_CAP_OLD)} cap, so in the old regime prepaying lowers the deduction. Compare "
                  f"your tax slab with the loan rate on Plan's tax view.", None, rupees(yearly), i)]


CHECKS = (_tax_claims, _order_claims, _rate_claims, _emi_claims, _fee_claims, _route_claims, _min_due_claims,
          _consolidate_claims, _invest_claims, _repo_claims)


def check(text: str, loans: list[AdviceLoan], plan: PlanFacts) -> Report:
    rep = Report()
    for s in sentences(text or ""):
        idx = mentioned_loans(s, loans)
        found: list[Claim] = []
        for fn in CHECKS:
            found.extend(fn(s, loans, idx, plan))
        if found:
            rep.claims.extend(found)
        elif percents(s) or money(s) or _ORDER.search(s) or _PREPAY.search(s):
            rep.not_checked.append(_quote(s))
        if len(rep.claims) >= MAX_CLAIMS:
            break
    rep.claims = rep.claims[:MAX_CLAIMS]
    rep.not_checked = rep.not_checked[:10]
    return rep
