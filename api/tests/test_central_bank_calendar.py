"""The meeting calendar matches the central banks' published schedules
(critique #72). Sources are saved in
engine/tests/fixtures/rbi_extracts/central_bank_calendars.txt."""
import json
import re
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CAL = json.loads((ROOT / "api" / "data" / "central_bank_calendar.json").read_text())
SRC = (ROOT / "engine" / "tests" / "fixtures" / "rbi_extracts" / "central_bank_calendars.txt").read_text()
MONTHS = {m: i for i, m in enumerate(
    ["January", "February", "March", "April", "May", "June", "July", "August",
     "September", "October", "November", "December"], 1)}


def _rbi_published() -> list[date]:
    """'April 6, 7 and 8, 2026' → 2026-04-08 (the decision day)."""
    out = []
    for month, days, year in re.findall(r"(\w+) ([\d, ]+and \d+), (\d{4})", SRC):
        if month in MONTHS:
            out.append(date(int(year), MONTHS[month], int(days.split("and")[-1])))
    return out


def _fed_2027() -> list[date]:
    out = []
    for month, day in re.findall(r"and Wednesday, (\w+) (\d+)(?!, 2028)\b", SRC):
        out.append(date(2027, MONTHS[month], int(day)))
    return out


def test_rbi_fy_2026_27_dates_are_the_published_ones():
    published = _rbi_published()
    assert len(published) == 6 and published[0] == date(2026, 4, 8) and published[-1] == date(2027, 2, 5)
    ours = [date.fromisoformat(m["date"]) for m in CAL["meetings"]["IN"]]
    assert [d for d in ours if d >= date(2026, 4, 1)] == published


def test_no_unpublished_rbi_meetings():
    """FY 2027-28 dates are published in March 2027; none may be guessed."""
    assert all(m["date"] <= "2027-03-31" for m in CAL["meetings"]["IN"])


def test_fed_2027_dates_are_the_tentative_published_ones():
    ours = [date.fromisoformat(m["date"]) for m in CAL["meetings"]["US"] if m["date"] >= "2027"]
    assert ours == _fed_2027() and len(ours) == 8


def test_every_meeting_has_a_status_and_only_held_ones_have_outcomes():
    for country, rows in CAL["meetings"].items():
        assert rows == sorted(rows, key=lambda m: m["date"]), country
        for m in rows:
            assert m["status"] in ("held", "scheduled", "tentative")
            assert (m["outcome_rate"] is not None) == (m["status"] == "held"), m


def test_held_rbi_outcomes_match_the_repo_history():
    from decimal import Decimal

    from engine import policy_rates
    from engine.models import Country
    for m in CAL["meetings"]["IN"]:
        if m["status"] == "held":
            assert policy_rates.rate_on(Country.IN, date.fromisoformat(m["date"])) == Decimal(m["outcome_rate"])
