"""Citation check: every rule the app cites is tied to the rule's own words.

A citation may be marked verified only when its `clause` is a verbatim copy
that appears in a saved source extract (fixtures/rbi_extracts/), and the
plain-language summary carries every key fact of that clause. Until then
the app labels the requirement a summary.
"""
import json
import re
from pathlib import Path

import pytest

from engine import citations

FIXTURES = Path(__file__).parent / "fixtures"
SOURCES = json.loads((FIXTURES / "citation_sources.json").read_text())
EXTRACTS = FIXTURES / "rbi_extracts"
NAMED = {
    name: value for name, value in vars(citations).items()
    if isinstance(value, citations.Citation)
}


def _norm(text: str) -> str:
    """Whitespace-insensitive, quote-style-insensitive, page numbers dropped."""
    text = re.sub(r"\n\s*\d{1,3}\s*\n", "\n", text)       # a page number on its own line
    text = text.replace("’", "'").replace("‘", "'").replace("“", '"').replace("”", '"')
    return re.sub(r"\s+", " ", text).strip()


def _extract_text(c: citations.Citation) -> str:
    return " ".join(_norm((EXTRACTS / f).read_text()) for f in c.extract.split(","))


def test_every_citation_has_a_source_entry():
    assert set(NAMED) - {"IO_DIRECTIONS_2023"} == {k for k in SOURCES if not k.startswith("_")}
    assert set(citations.ALL) == set(NAMED.values())


@pytest.mark.parametrize("name", sorted(NAMED))
def test_summary_carries_the_key_facts(name):
    entry = SOURCES[name]
    assert entry["where"], f"{name}: say where the rule can be read"
    for fact in entry["key_facts"]:
        assert re.search(re.escape(fact.replace("-", " ")), NAMED[name].requirement.replace("-", " "), re.IGNORECASE), (
            f"{name}: summary is missing '{fact}'"
        )


@pytest.mark.parametrize("name", sorted(NAMED))
def test_verified_only_with_the_quoted_text(name):
    c = NAMED[name]
    if not c.verified_against_text:
        assert not c.clause, f"{name}: has a clause; verify it or drop it"
        return
    assert c.clause and c.extract and c.url.startswith("https://") and c.checked_on, name
    source = _extract_text(c)
    for fragment in c.clause.split(" … "):
        assert _norm(fragment) in source, f"{name}: not verbatim in {c.extract}: {fragment[:80]}…"
    for fact in SOURCES[name]["key_facts"]:
        assert re.search(re.escape(fact), c.clause, re.IGNORECASE), f"{name}: clause lacks '{fact}'"


def test_extracts_say_where_they_came_from():
    for f in EXTRACTS.glob("*.txt"):
        head = f.read_text().splitlines()[:3]
        assert head[1].startswith("# Source: http"), f.name
        assert head[2].startswith("# Retrieved: "), f.name


def test_old_wrong_references_are_gone():
    """Regressions from the 12 Oct 2026 check: the repeal circular's number was
    given as the Directions' number, and the repealed 2023 Internal Ombudsman
    Directions were cited."""
    text = " ".join(c.rule + c.source for c in citations.ALL)
    assert "DOR.RRC.REC.302" not in text
    assert "Internal Ombudsman for Regulated Entities" not in text
    assert "RBI/DOR/2025-26/161" in citations.EBLR_RESET.rule


def test_letters_only_cite_known_rules():
    from datetime import date
    from decimal import Decimal as D

    from engine.complaint_deadlines import Reply, india_timeline
    from engine.complaints_in import grievance_letter, io_followup_letter, ombudsman_complaint
    from engine.loan_check import Benchmark, LoanCheckInput, check_loan

    inp = LoanCheckInput(
        loan_start=date(2022, 1, 1), start_rate=D("0.0690"), current_rate=D("0.0890"),
        outstanding=D("4000000"), tenure_months_remaining=200, as_of=date(2026, 9, 26),
        benchmark=Benchmark.REPO,
    )
    r = check_loan(inp)
    cited = set(grievance_letter(inp, r).citations)
    cited |= set(io_followup_letter(inp, r, date(2026, 9, 1), Reply.REJECTED, date(2026, 9, 10)).citations)
    t = india_timeline(date(2026, 9, 1), today=date(2026, 9, 26))
    cited |= set(ombudsman_complaint(inp, r, t, sent_on=date(2026, 9, 1)).citations)
    for f in r.findings:
        cited |= set(f.citations)
    assert cited <= set(citations.ALL)
    # Everything a letter cites has been checked against the rule's own text.
    assert all(c.verified_against_text for c in cited)
