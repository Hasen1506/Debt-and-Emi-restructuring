"""G7 (retention + pay): payday email, closure letter, reminders, D30/D60."""
from datetime import date
from decimal import Decimal as D

import pytest
from hypothesis import given, settings, strategies as st

from engine import closure_letter as cl
from engine import payday, reminders, retention

LINKS = {k: f"https://rightdue.app/x/{k}" for k in ("all_paid", "some_paid", "cant_pay", "open_app", "unsubscribe")}


def snap(**over):
    data = {
        "month": "2026-11", "made_on": "2026-10-30", "country": "IN", "currency": "INR",
        "rows": [
            {"name": "HDFC credit card", "amount": "18500", "kind": "extra", "due_day": 5},
            {"name": "SBI home loan", "amount": "32000", "kind": "emi"},
            {"name": "Emergency fund", "amount": "4000", "kind": "ef"},
        ],
    }
    data.update(over)
    return data


# ── payday: input ───────────────────────────────────────────────────────────

def test_snapshot_parses_and_totals_in_users_currency():
    s = payday.parse_snapshot(snap())
    assert s.total == D("54500")
    assert [r.kind for r in s.rows] == ["extra", "emi", "ef"]
    assert s.rows[0].due_day == 5


@pytest.mark.parametrize("bad, msg", [
    ({"month": "2026-13"}, "month"),
    ({"rows": []}, "no payments"),
    ({"rows": [{"name": "x", "amount": "-5", "kind": "emi"}]}, "out of range"),
    ({"rows": [{"name": "x", "amount": "abc", "kind": "emi"}]}, "not a number"),
    ({"rows": [{"name": "x", "amount": "5", "kind": "bonus"}]}, "unknown kind"),
    ({"rows": [{"name": "  ", "amount": "5", "kind": "emi"}]}, "needs a name"),
    ({"country": "UK"}, "Country"),
    ({"rows": [{"name": "x", "amount": "5", "kind": "emi", "due_day": 40}]}, "due day"),
])
def test_snapshot_rejects_bad_input_with_plain_message(bad, msg):
    with pytest.raises(payday.SnapshotError, match=msg):
        payday.parse_snapshot(snap(**bad))


def test_snapshot_strips_markup_from_names_so_the_email_cannot_carry_html():
    s = payday.parse_snapshot(snap(rows=[{"name": "<script>alert(1)</script> Card", "amount": "10", "kind": "emi"}]))
    assert "<" not in s.rows[0].name and ">" not in s.rows[0].name
    d = payday.build_digest(s, today=date(2026, 11, 1), links=LINKS)
    assert "<script>" not in d.html


def test_snapshot_caps_rows():
    rows = [{"name": f"L{i}", "amount": "1", "kind": "emi"} for i in range(payday.MAX_ROWS + 1)]
    with pytest.raises(payday.SnapshotError, match="At most"):
        payday.parse_snapshot(snap(rows=rows))


# ── payday: when ────────────────────────────────────────────────────────────

def test_payday_clamps_to_month_end_like_payroll():
    assert payday.payday_in(2026, 2, 31) == date(2026, 2, 28)
    assert payday.payday_in(2028, 2, 30) == date(2028, 2, 29)
    assert payday.payday_in(2026, 4, 31) == date(2026, 4, 30)
    assert payday.payday_in(2026, 5, 1) == date(2026, 5, 1)


def test_due_once_a_month_with_a_short_catch_up_window():
    assert payday.due_payday(date(2026, 11, 1), 1, None) == date(2026, 11, 1)
    assert payday.due_payday(date(2026, 11, 4), 1, "2026-10") == date(2026, 11, 1)   # cron missed 3 days
    assert payday.due_payday(date(2026, 11, 5), 1, "2026-10") is None                # too late: skip the month
    assert payday.due_payday(date(2026, 11, 1), 1, "2026-11") is None                # already sent
    assert payday.due_payday(date(2026, 10, 31), 1, None) is None                    # before payday


@settings(max_examples=200, deadline=None)
@given(st.dates(min_value=date(2025, 1, 1), max_value=date(2030, 12, 31)), st.integers(1, 31))
def test_never_two_emails_in_one_month(today, day):
    first = payday.due_payday(today, day, None)
    if first is not None:
        assert payday.due_payday(today, day, f"{today:%Y-%m}") is None
        assert first <= today


# ── payday: words ───────────────────────────────────────────────────────────

def test_digest_lists_payments_in_order_with_indian_grouping_and_honest_copy():
    d = payday.build_digest(payday.parse_snapshot(snap()), today=date(2026, 11, 1), links=LINKS)
    assert d.subject == "Payday: ₹54,500 across 3 payments, in this order"
    t = d.text
    assert t.index("1. HDFC credit card: ₹18,500") < t.index("2. SBI home loan: ₹32,000")
    assert "(due on the 5th)" in t
    assert "can't see your bank account" in t
    assert "not financial advice" in t
    for k in ("all_paid", "some_paid", "cant_pay", "unsubscribe"):
        assert LINKS[k] in t and LINKS[k] in d.html
    assert not d.stale
    assert "reply" not in t.lower()        # replies only when inbound is configured


def test_digest_flags_a_stale_list():
    d = payday.build_digest(payday.parse_snapshot(snap(made_on="2026-09-01")), today=date(2026, 11, 1), links=LINKS)
    assert d.stale and "Open RightDue to refresh it" in d.text


def test_digest_says_when_the_list_is_from_last_month():
    d = payday.build_digest(payday.parse_snapshot(snap(month="2026-10", made_on="2026-10-28")),
                            today=date(2026, 11, 1), links=LINKS)
    assert not d.stale and "list from your plan on 28 October 2026" in d.text
    d = payday.build_digest(payday.parse_snapshot(snap(month="2026-11", made_on="2026-11-01")),
                            today=date(2026, 11, 1), links=LINKS)
    assert d.notes == []


def test_digest_mentions_reply_only_when_enabled():
    d = payday.build_digest(payday.parse_snapshot(snap()), today=date(2026, 11, 1), links=LINKS, reply_enabled=True)
    assert 'reply to this email with the word "done"' in d.text


def test_money_formats():
    assert payday.money(D("1234567"), "INR") == "₹12,34,567"
    assert payday.money(D("1234567"), "USD") == "$1,234,567"
    assert payday.money(D("999"), "INR") == "₹999"


@pytest.mark.parametrize("text, want", [
    ("done", True),
    ("Done!\n\nOn Sat, 1 Nov 2026 RightDue wrote:\n> reply done", True),
    ("Paid", True),
    ("not done yet", False),
    ("I couldn't pay the card", False),
    ("> done\n", None),                        # only the quote: never confirms itself
    ("thanks", None),
    ("", None),
    ("On Sat, 1 Nov 2026 RightDue wrote:\n> Reply done", None),
])
def test_reply_reading(text, want):
    assert payday.reply_says_done(text) is want


# ── closure letter ──────────────────────────────────────────────────────────

def test_home_loan_bank_letter_has_30_day_documents_date_and_cites_bank_directions():
    r = cl.closure_letter(market="IN", loan_type="home_loan", lender="HDFC Bank", closed_on=date(2026, 10, 1),
                          today=date(2026, 10, 12), lender_kind="bank")
    dates = {k.key: k.day for k in r.key_dates}
    assert dates["documents_by"] == date(2026, 10, 31)
    assert dates["compensation_from"] == date(2026, 11, 1)
    assert "Commercial Banks – Responsible Business Conduct" in r.body
    assert "₹5,000 for each day of delay" in r.body
    assert "CERSAI" in r.body
    assert r.draft
    assert any("rbi.org.in" in c["source"] for c in r.citations)


def test_hfc_gets_the_nbfc_directions_and_lost_documents_get_60_days():
    r = cl.closure_letter(market="IN", loan_type="home_loan", lender="LIC Housing Finance", closed_on=date(2026, 10, 1),
                          today=date(2026, 10, 12), lender_kind="hfc", docs_lost=True)
    assert "Non-Banking Financial Companies – Responsible Business Conduct" in r.body
    assert {k.key: k.day for k in r.key_dates}["documents_by"] == date(2026, 11, 30)


def test_unknown_lender_quotes_the_2023_circular_not_a_guess():
    r = cl.closure_letter(market="IN", loan_type="home_loan", lender="X", closed_on=date(2026, 10, 1),
                          today=date(2026, 10, 12))
    assert "RBI/2023-24/60" in r.body


def test_car_loan_asks_for_form_35():
    r = cl.closure_letter(market="IN", loan_type="auto_loan", lender="ICICI Bank", closed_on=date(2026, 10, 1),
                          today=date(2026, 10, 12), lender_kind="bank")
    assert "Form 35" in r.body and "RTO" in r.body


def test_card_closure_seven_working_days_from_request_and_500_a_day():
    # Request on Mon 12 Oct 2026: 7 working days (weekends skipped) = Wed 21 Oct.
    r = cl.closure_letter(market="IN", loan_type="credit_card", lender="SBI Card", closed_on=date(2026, 10, 9),
                          today=date(2026, 10, 12), lender_kind="nbfc")
    d = {k.key: k.day for k in r.key_dates}
    assert d["card_closed_by"] == date(2026, 10, 21)
    assert d["card_penalty_from"] == date(2026, 10, 22)
    assert "₹500 for each calendar day" in r.body


def test_working_days_skip_weekends():
    assert cl.add_working_days(date(2026, 10, 16), 1) == date(2026, 10, 19)   # Fri → Mon
    assert cl.add_working_days(date(2026, 10, 12), 5) == date(2026, 10, 19)


def test_personal_loan_has_no_document_rule_and_business_loan_drops_the_rule():
    r = cl.closure_letter(market="IN", loan_type="personal_loan", lender="Bajaj Finance", closed_on=date(2026, 10, 1),
                          today=date(2026, 10, 12), lender_kind="nbfc")
    assert r.key_dates == [] and "original property documents" not in r.body
    r = cl.closure_letter(market="IN", loan_type="home_loan", lender="Bank", closed_on=date(2026, 10, 1),
                          today=date(2026, 10, 12), lender_kind="bank", business_purpose=True)
    assert r.key_dates == [] and "₹5,000" not in r.body and r.notes


def test_gold_loan_seven_working_days_only_for_commercial_banks():
    r = cl.closure_letter(market="IN", loan_type="gold_loan", lender="Bank", closed_on=date(2026, 10, 12),
                          today=date(2026, 10, 12), lender_kind="bank")
    assert {k.key for k in r.key_dates} == {"gold_back_by"}
    r = cl.closure_letter(market="IN", loan_type="gold_loan", lender="Muthoot", closed_on=date(2026, 10, 12),
                          today=date(2026, 10, 12), lender_kind="nbfc")
    assert r.key_dates == [] and r.notes


def test_us_letter_quotes_no_deadline():
    r = cl.closure_letter(market="US", loan_type="home_loan", lender="Chase", closed_on=date(2026, 10, 1),
                          today=date(2026, 10, 12))
    assert r.key_dates == [] and "lien" in r.body and r.notes
    assert "RBI" not in r.body


@pytest.mark.parametrize("kw, msg", [
    ({"market": "UK"}, "Market"),
    ({"loan_type": "yacht"}, "loan type"),
    ({"closed_on": date(2026, 12, 1)}, "future"),
    ({"lender_kind": "friend"}, "lender type"),
])
def test_closure_rejects_bad_input(kw, msg):
    args = dict(market="IN", loan_type="home_loan", lender="X", closed_on=date(2026, 10, 1), today=date(2026, 10, 12))
    args.update(kw)
    with pytest.raises(cl.ClosureInputError, match=msg):
        cl.closure_letter(**args)


# ── reminders ───────────────────────────────────────────────────────────────

def test_borrower_deadline_gets_week_day_before_and_day_of():
    it = reminders.Item("ombudsman_deadline", "Last day to file with the RBI Ombudsman", date(2027, 1, 30))
    rs = reminders.schedule([it], today=date(2027, 1, 1))
    assert [r.send_on for r in rs] == [date(2027, 1, 23), date(2027, 1, 29), date(2027, 1, 30)]
    assert rs[1].text.startswith("Tomorrow")


def test_lender_deadline_reminds_the_day_after():
    it = reminders.Item("reply", "Bank's reply due", date(2026, 11, 11))
    rs = reminders.schedule([it], today=date(2026, 10, 12))
    assert [(r.send_on, r.lead) for r in rs] == [(date(2026, 11, 12), -1)]
    assert "next step is open" in rs[0].text


def test_closure_dates_feed_reminders():
    r = cl.closure_letter(market="IN", loan_type="home_loan", lender="HDFC Bank", closed_on=date(2026, 10, 1),
                          today=date(2026, 10, 12), lender_kind="bank")
    items = [reminders.Item(k.key, k.label, k.day, "closure") for k in r.key_dates]
    rs = reminders.schedule(items, today=date(2026, 10, 12))
    assert (rs[0].key, rs[0].send_on) == ("compensation_from", date(2026, 11, 1)) or rs[0].key == "documents_by"
    assert {r.key for r in rs} == {"documents_by", "compensation_from"}


# ── D30 / D60 ───────────────────────────────────────────────────────────────

def test_return_rates_count_only_actions_in_the_window():
    opted = {"a": date(2026, 1, 1), "b": date(2026, 1, 1), "c": date(2026, 3, 1)}
    ev = [
        retention.Event("a", "sent", date(2026, 2, 1)),        # an email isn't a return
        retention.Event("b", "ack_all", date(2026, 2, 5)),     # day 35: D30
        retention.Event("b", "snapshot", date(2026, 3, 10)),   # day 68: D60
        retention.Event("x", "ack_all", date(2026, 2, 5)),     # not opted in
    ]
    d30, d60 = retention.return_rates(opted, ev, date(2026, 3, 15))
    assert (d30.eligible, d30.returned) == (2, 1)       # c is only 14 days in
    assert (d60.eligible, d60.returned) == (2, 1)
    assert d30.share == 0.5
    assert retention.return_rates({}, [], date(2026, 1, 1))[0].share is None
