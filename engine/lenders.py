"""Which lender is this, and which RBI rules bind it?

Two jobs:

1. Map what a borrower typed to one lender. Shared outcome reports
   (engine/outcomes.py) are grouped by lender, so "HDFC", "HDFC Bank Ltd."
   and "hdfc bank" must land on one record, and a made-up bank must land on
   none: a lost version accepted any name, and 36 fake reports gave an
   invented bank a 100% record.

2. Say what kind of lender it is, because the rule Loan Check tests (a
   floating-rate home loan must follow an external benchmark such as the
   repo rate) binds only some of them (engine/citations.py, EBLR_SCOPE):

   - commercial banks (public, private, foreign, SBI): yes, Commercial Banks
     – Interest Rates on Advances Directions, 2025, paras 25, 33, 38;
   - small finance banks: yes, their own Directions with the same text;
   - regional rural banks and co-operative banks: no. Their Interest Rates
     on Advances Directions, 2025 contain no external-benchmark rule;
   - housing finance companies and other NBFCs: no. They price against
     their own benchmark under a Board-approved interest rate model
     (HFC_RATE_POLICY), and HFCs are outside the RBI Ombudsman scheme.

   The verdict never depends on matching a name silently: the borrower
   states the lender type (the screen asks), and a known name only fills it
   in. A name that contradicts the stated type is an input error.

HFC names are from the National Housing Bank's list of HFC grievance
contacts (nhb.org.in, Annexure 3, March 2026).
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from enum import Enum
from typing import Optional

from engine.models import Country
from engine.rate_cards import INDIA_TIER_A, INDIA_TIER_B, INDIA_TIER_C


class LenderType(str, Enum):
    COMMERCIAL_BANK = "commercial_bank"
    SMALL_FINANCE_BANK = "small_finance_bank"
    REGIONAL_RURAL_BANK = "regional_rural_bank"
    COOPERATIVE_BANK = "cooperative_bank"
    HFC = "hfc"
    NBFC = "nbfc"
    UNKNOWN = "unknown"


# Lenders the repo-rate (external benchmark) rule binds.
EBLR_BOUND = frozenset({LenderType.COMMERCIAL_BANK, LenderType.SMALL_FINANCE_BANK})

TYPE_LABEL: dict[LenderType, str] = {
    LenderType.COMMERCIAL_BANK: "a commercial bank",
    LenderType.SMALL_FINANCE_BANK: "a small finance bank",
    LenderType.REGIONAL_RURAL_BANK: "a regional rural bank",
    LenderType.COOPERATIVE_BANK: "a co-operative bank",
    LenderType.HFC: "a housing finance company",
    LenderType.NBFC: "a non-bank lender (NBFC)",
    LenderType.UNKNOWN: "a lender of a type not given",
}


@dataclass(frozen=True)
class Lender:
    id: str        # "IN_HDFC"
    name: str      # "HDFC Bank", as the app shows it everywhere
    type: LenderType = LenderType.COMMERCIAL_BANK
    has_rate_card: bool = False   # a published new-borrower home-loan rate card

    @property
    def eblr_bound(self) -> bool:
        return self.type in EBLR_BOUND


# Other names people type. The card's own name is always accepted.
_ALIASES: dict[str, tuple[str, ...]] = {
    "IN_SBI": ("state bank of india", "state bank", "sbi bank"),
    "IN_HDFC": ("hdfc", "hdfc limited", "housing development finance corporation"),
    "IN_ICICI": ("icici",),
    "IN_AXIS": ("axis",),
    "IN_KOTAK": ("kotak", "kotak bank", "kotak mahindra bank"),
    "IN_PNB": ("punjab national bank",),
    "IN_BOB": ("bob", "baroda"),
    "IN_CANARA": ("canara",),
    "IN_BOI": ("boi",),
    "IN_UNION_BANK": ("union bank of india", "ubi"),
    "IN_INDIAN_BANK": (),
    "IN_CENTRAL_BANK": ("central bank of india",),
    "IN_IDBI": ("idbi bank",),
    "IN_YES_BANK": (),
    "IN_IDFC_FIRST": ("idfc first bank", "idfc", "idfc bank"),
    "IN_INDUSIND": ("indusind",),
    "IN_FEDERAL": ("federal",),
    "IN_SOUTH_INDIAN": ("sib",),
    "IN_RBL": ("rbl", "ratnakar bank"),
    "IN_BANDHAN": ("bandhan",),
    "IN_AU_SFB": ("au small finance bank", "au bank"),
    "IN_UCO": ("uco",),
    "IN_BANK_OF_MAHARASHTRA": ("mahabank",),
    "IN_PUNJAB_AND_SIND": ("punjab and sind bank", "psb"),
    "IN_KARNATAKA": (),
    "IN_KARUR_VYSYA": ("karur vysya bank", "kvb"),
    "IN_CITY_UNION": ("city union bank", "cub"),
    "IN_JANDK": ("jammu and kashmir bank", "jk bank"),
    "IN_UJJIVAN_SFB": ("ujjivan", "ujjivan small finance bank"),
    "IN_SURYODAY_SFB": ("suryoday", "suryoday small finance bank"),
}

_SFB = {"IN_AU_SFB", "IN_UJJIVAN_SFB", "IN_SURYODAY_SFB"}

# Housing finance companies: (id, name shown, other names people type).
_HFCS: tuple[tuple[str, str, tuple[str, ...]], ...] = (
    ("IN_HFC_LICHFL", "LIC Housing Finance", ("lic housing", "lic hfl", "lichfl", "lic housing finance limited")),
    ("IN_HFC_PNBHFL", "PNB Housing Finance", ("pnb housing", "pnb hfl", "pnbhfl")),
    ("IN_HFC_BAJAJ", "Bajaj Housing Finance", ("bajaj housing", "bajaj hfl")),
    ("IN_HFC_CANFIN", "Can Fin Homes", ("canfin homes", "can fin")),
    ("IN_HFC_GIC", "GIC Housing Finance", ("gic housing", "gic hfl")),
    ("IN_HFC_AADHAR", "Aadhar Housing Finance", ("aadhar housing",)),
    ("IN_HFC_AAVAS", "Aavas Financiers", ("aavas",)),
    ("IN_HFC_ABHFL", "Aditya Birla Housing Finance", ("aditya birla housing", "abhfl")),
    ("IN_HFC_GODREJ", "Godrej Housing Finance", ("godrej housing",)),
    ("IN_HFC_HOMEFIRST", "Home First Finance", ("home first", "homefirst", "home first finance company")),
    ("IN_HFC_ICICI_HOME", "ICICI Home Finance", ("icici home", "icici hfc")),
    ("IN_HFC_INDIA_SHELTER", "India Shelter Finance", ("india shelter",)),
    ("IN_HFC_REPCO", "Repco Home Finance", ("repco", "repco home")),
    ("IN_HFC_TATA", "Tata Capital Housing Finance", ("tata capital housing", "tata housing finance")),
    ("IN_HFC_TRUHOME", "Truhome Finance", ("truhome",)),
    ("IN_HFC_MUTHOOT", "Muthoot Homefin", ("muthoot homefin india", "muthoot housing finance")),
)

_SUFFIXES = ("limited", "ltd", "co", "company")


def normalise(text: str) -> str:
    """'The HDFC Bank Ltd.' → 'hdfc bank'; '&' reads as 'and'."""
    s = text.lower().replace("&", " and ")
    s = re.sub(r"[^a-z0-9]+", " ", s).strip()
    words = s.split()
    if words[:1] == ["the"]:
        words = words[1:]
    while words and words[-1] in _SUFFIXES:
        words = words[:-1]
    return " ".join(words)


def _build() -> tuple[dict[str, Lender], dict[str, Lender]]:
    by_id: dict[str, Lender] = {}
    by_key: dict[str, Lender] = {}

    def add(lender: Lender, names: tuple[str, ...]) -> None:
        by_id[lender.id] = lender
        for key in names:
            k = normalise(key)
            if k in by_key and by_key[k] != lender:
                raise ValueError(f"lender alias {key!r} is used twice")
            by_key[k] = lender

    for card in INDIA_TIER_A + INDIA_TIER_B + INDIA_TIER_C:
        kind = LenderType.SMALL_FINANCE_BANK if card.institution_id in _SFB else LenderType.COMMERCIAL_BANK
        add(Lender(card.institution_id, card.name, kind, card.home_loan is not None),
            (card.name, *_ALIASES.get(card.institution_id, ())))
    for lid, name, aliases in _HFCS:
        add(Lender(lid, name, LenderType.HFC, False), (name, *aliases))
    missing = set(_ALIASES) - set(by_id)
    if missing:
        raise ValueError(f"aliases for unknown lenders: {sorted(missing)}")
    return by_id, by_key


_BY_ID, _BY_KEY = _build()


def resolve(text: Optional[str], country: Country = Country.IN) -> Optional[Lender]:
    """The lender `text` names, or None if it isn't one we know."""
    if country != Country.IN or not text:
        return None
    key = normalise(text)
    if not key:
        return None
    return _BY_KEY.get(key) or _BY_KEY.get(key.removesuffix(" bank"))


def resolve_bank(text: Optional[str], country: Country = Country.IN) -> Optional[Lender]:
    """Like resolve, but only lenders the repo-rate rule binds (outcome reports)."""
    found = resolve(text, country)
    return found if found is not None and found.eblr_bound else None


def by_id(lender_id: str) -> Optional[Lender]:
    return _BY_ID.get(lender_id)


def all_lenders() -> list[Lender]:
    return list(_BY_ID.values())


def banks() -> list[Lender]:
    return [x for x in _BY_ID.values() if x.eblr_bound]
