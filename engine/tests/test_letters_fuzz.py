"""Fuzz: every letter for 300 random loans and random complaint states.

A letter goes to a bank, so the rules are strict:
- never a stray "you" (app copy leaking into a letter);
- the claim is the missed rate cut only, equal to Loan Check's figure,
  and the annexure adds up to it;
- no negative amounts, no formatting leftovers, only known placeholders.
"""
import random
import re
from datetime import date, timedelta
from decimal import Decimal

from engine import policy_rates
from engine.complaint_deadlines import Reply, TimelineInputError, india_timeline
from engine.complaints_in import (
    ACCOUNT, ADDRESS, BANK_NAME, BANK_REFERENCE, EMAIL, NAME, PHONE,
    NothingToClaim, grievance_letter, io_followup_letter, ombudsman_complaint, stray_you,
)
from engine.loan_check import Benchmark, LoanCheckInput, check_loan
from engine.models import Country

D = Decimal
TODAY = date(2026, 9, 26)
KNOWN_PLACEHOLDERS = {NAME, ACCOUNT, PHONE, EMAIL, ADDRESS, BANK_NAME, BANK_REFERENCE}
BRACKETS = re.compile(r"\[[^\]]*\]")
RUPEES = re.compile(r"(.)₹([\d,]+)")
LEFTOVERS = re.compile(r"\bNone\b|\bnan\b|[{}]| \.| ,|\.\.|%%")


def _months():
    out, m = [], date(2019, 10, 1)
    while m <= date(2026, 9, 1):
        out.append(m)
        m = date(m.year + m.month // 12, m.month % 12 + 1, 1)
    return out


def _check_text(text: str, where: str):
    assert stray_you(text) is None, f"{where}: stray '{stray_you(text)}'"
    assert "new borrowers" not in text.lower(), where
    m = LEFTOVERS.search(text)
    assert m is None, f"{where}: leftover {m.group(0)!r} in …{text[max(0, m.start() - 40):m.end() + 40]}…"
    assert set(BRACKETS.findall(text)) <= KNOWN_PLACEHOLDERS, (where, BRACKETS.findall(text))
    for before, amount in RUPEES.findall(text):
        assert before not in "-−", f"{where}: negative amount"
        assert D(amount.replace(",", "")) >= 0


def test_letters_for_random_loans():
    rng = random.Random(20260927)
    months = _months()
    letters = nothing = 0
    for _ in range(300):
        start = rng.choice(months)
        repo0 = policy_rates.rate_on(Country.IN, start)
        inp = LoanCheckInput(
            loan_start=start,
            start_rate=(repo0 + D(rng.randint(150, 400)) / D("10000")).quantize(D("0.0001")),
            current_rate=(D("0.0525") + D(rng.randint(100, 500)) / D("10000")).quantize(D("0.0001")),
            outstanding=D(rng.randint(100_000, 20_000_000)),
            tenure_months_remaining=rng.randint(1, 360),
            as_of=TODAY,
            lender=rng.choice([None, "SBI", "HDFC Bank", "ICICI Bank", "Nope Bank", "  "]),
            benchmark=rng.choice([Benchmark.REPO, Benchmark.UNKNOWN]),
            last_reset=rng.choice([None, None, start, min(TODAY.replace(day=1), date(2024, 6, 1))])
            if start <= date(2024, 6, 1) else None,
        )
        result = check_loan(inp)
        missed = [f for f in result.findings if f.kind == "missed_rate_cut"]
        if not missed:
            try:
                grievance_letter(inp, result)
            except NothingToClaim:
                nothing += 1
                continue
            raise AssertionError("letter written with nothing to claim")

        f = missed[0]
        letter = grievance_letter(inp, result, sent_on=TODAY)
        letters += 1
        text = letter.text()
        _check_text(text, "grievance")
        assert letter.claim_amount == f.overcharged_so_far == result.claim_amount
        assert len(letter.annexure) == f.months_overcharged
        assert sum(
            (D(r.excess.lstrip("₹").replace(",", "")) for r in letter.annexure), D("0")
        ) == letter.claim_amount
        assert f"{(result.expected_rate * 100).quantize(D('0.01'))}%" in text
        # The pricing gap never leaks in: no refund line beyond the one claim.
        assert sum(1 for q in letter.requests if q.startswith("Refund")) == (1 if f.overcharged_so_far > 0 else 0)

        # A random point in the complaint's life.
        sent = TODAY - timedelta(days=rng.randint(0, 200))
        reply = rng.choice(list(Reply))
        reply_on = sent + timedelta(days=rng.randint(0, (TODAY - sent).days)) if reply != Reply.NONE else None
        io_reviewed = rng.random() < 0.5
        t = india_timeline(sent, today=TODAY, reply=reply, reply_on=reply_on, io_reviewed=io_reviewed)
        if t.escalation_opens:
            assert t.escalation_opens > sent or (io_reviewed and t.escalation_opens == reply_on)
            assert t.escalation_deadline > t.escalation_opens
        if reply in (Reply.PARTLY, Reply.REJECTED):
            io = io_followup_letter(inp, result, sent_on=sent, reply=reply, reply_on=reply_on,
                                    bank_reference=rng.choice([None, "GRV-1", " "]), today=TODAY)
            _check_text(io.text(), "io_followup")
        if t.stage not in ("fixed", "window_closed"):
            c = ombudsman_complaint(inp, result, t, sent_on=sent, reply=reply, reply_on=reply_on)
            _check_text(c.facts, "ombudsman facts")
            _check_text(c.relief, "ombudsman relief")
            for fld in c.fields:
                _check_text(fld.value, f"ombudsman field {fld.label}")
            assert c.claim_amount == letter.claim_amount

    # The generator must exercise both paths.
    assert letters > 50 and nothing > 20, (letters, nothing)


def test_timelines_never_invert():
    rng = random.Random(7)
    for _ in range(500):
        sent = TODAY - timedelta(days=rng.randint(0, 400))
        received = sent + timedelta(days=rng.randint(0, 10))
        reply = rng.choice(list(Reply))
        reply_on = None
        if reply != Reply.NONE:
            reply_on = sent + timedelta(days=rng.randint(0, max(0, (TODAY - sent).days)))
        try:
            t = india_timeline(sent, today=TODAY, received_on=received, reply=reply,
                               reply_on=reply_on, io_reviewed=rng.random() < 0.5)
        except TimelineInputError:
            assert received > TODAY
            continue
        days = [m.day for m in t.milestones if m.key in ("ombudsman_opens", "ombudsman_deadline")]
        assert days == sorted(days)
        assert all(m.day >= sent for m in t.milestones)
        if t.stage == "window_closed":
            assert t.days_left < 0
