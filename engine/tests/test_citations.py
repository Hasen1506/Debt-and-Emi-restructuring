"""Citation check: every rule the app cites has a source and key facts.

A citation may be marked verified only once the regulation's own wording
is in fixtures/citation_sources.json and contains each key fact. Until
then the app labels the requirement a summary.
"""
import json
import re
from pathlib import Path

import pytest

from engine import citations

SOURCES = json.loads((Path(__file__).parent / "fixtures" / "citation_sources.json").read_text())
NAMED = {
    name: value for name, value in vars(citations).items()
    if isinstance(value, citations.Citation)
}


def test_every_citation_has_a_source_entry():
    assert set(NAMED) == {k for k in SOURCES if not k.startswith("_")}
    assert set(citations.ALL) == set(NAMED.values())


@pytest.mark.parametrize("name", sorted(NAMED))
def test_summary_carries_the_key_facts(name):
    entry = SOURCES[name]
    assert entry["where"], f"{name}: say where the rule can be read"
    for fact in entry["key_facts"]:
        assert re.search(re.escape(fact), NAMED[name].requirement, re.IGNORECASE), (
            f"{name}: summary is missing '{fact}'"
        )


@pytest.mark.parametrize("name", sorted(NAMED))
def test_verified_only_with_the_quoted_text(name):
    entry, c = SOURCES[name], NAMED[name]
    quote = entry["quoted_clause"]
    if quote is None:
        assert not c.verified_against_text, f"{name}: marked verified with no quoted clause"
        return
    for fact in entry["key_facts"]:
        assert re.search(re.escape(fact), quote, re.IGNORECASE), f"{name}: quote lacks '{fact}'"
    assert c.verified_against_text, f"{name}: quote is in; set verified_against_text=True"


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
