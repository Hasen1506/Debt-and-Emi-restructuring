"""Which bank is this? Map what a borrower typed to one lender.

Shared outcome reports (engine/outcomes.py) are grouped by lender, so
"HDFC", "HDFC Bank Ltd." and "hdfc bank" must land on one record, and a
made-up bank must land on none: a lost version accepted any name, and 36
fake reports gave an invented bank a 100% record. Only the banks in
engine/rate_cards.py are accepted.

Housing finance companies (LIC HFL, PNB Housing, ...) are left out on
purpose: Loan Check tests the RBI's external-benchmark rules for banks.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Optional

from engine.models import Country
from engine.rate_cards import INDIA_TIER_A, INDIA_TIER_B, INDIA_TIER_C


@dataclass(frozen=True)
class Lender:
    id: str        # "IN_HDFC"
    name: str      # "HDFC Bank", as the app shows it everywhere


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
    for card in INDIA_TIER_A + INDIA_TIER_B + INDIA_TIER_C:
        lender = Lender(card.institution_id, card.name)
        by_id[lender.id] = lender
        for key in (card.name, *_ALIASES.get(card.institution_id, ())):
            k = normalise(key)
            if k in by_key and by_key[k] != lender:
                raise ValueError(f"lender alias {key!r} is used twice")
            by_key[k] = lender
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


def by_id(lender_id: str) -> Optional[Lender]:
    return _BY_ID.get(lender_id)


def all_lenders() -> list[Lender]:
    return list(_BY_ID.values())
