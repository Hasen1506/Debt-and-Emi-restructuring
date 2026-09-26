"""Complaint deadline tracker: India (RB-IOS 2026) and US (Reg X, Reg Z)."""
from datetime import date

import pytest

from engine.complaint_deadlines import (
    Reply, TimelineInputError, add_business_days, india_timeline,
    us_billing_error_timeline, us_legal_public_holidays, us_notice_of_error_timeline,
)


def _ms(t, key):
    return next(m for m in t.milestones if m.key == key)


# ── India ───────────────────────────────────────────────────────────────────

def test_india_waiting_for_reply():
    t = india_timeline(date(2026, 9, 1), today=date(2026, 9, 26))
    assert t.stage == "awaiting_reply"
    assert _ms(t, "reply").day == date(2026, 10, 1)
    assert t.escalation_opens == date(2026, 10, 2)
    assert t.escalation_deadline == date(2026, 12, 30)   # 1 Oct + 90 days
    assert t.days_left == 5
    assert any("sent" in n for n in t.notes)             # no receipt date given


def test_india_no_reply_opens_the_ombudsman():
    t = india_timeline(date(2026, 9, 1), today=date(2026, 10, 10))
    assert t.stage == "ombudsman_open"
    assert _ms(t, "reply").state == "overdue"
    assert "cms.rbi.org.in" in t.next_action
    assert t.days_left == (date(2026, 12, 30) - date(2026, 10, 10)).days


def test_india_rejection_without_io_review_waits_for_io():
    t = india_timeline(date(2026, 9, 1), today=date(2026, 9, 26),
                       reply=Reply.REJECTED, reply_on=date(2026, 9, 10))
    assert t.stage == "internal_ombudsman"
    assert _ms(t, "io_decision").day == date(2026, 10, 1)
    assert t.escalation_opens == date(2026, 10, 2)
    assert t.escalation_deadline == date(2026, 12, 30)


def test_india_final_rejection_opens_at_once():
    t = india_timeline(date(2026, 9, 1), today=date(2026, 9, 26),
                       reply=Reply.PARTLY, reply_on=date(2026, 9, 20), io_reviewed=True)
    assert t.stage == "ombudsman_open"
    assert t.escalation_opens == date(2026, 9, 20)
    assert t.escalation_deadline == date(2026, 12, 30)   # later of 1 Oct and 20 Sep


def test_india_late_reply_moves_the_deadline():
    t = india_timeline(date(2026, 9, 1), today=date(2026, 10, 25),
                       reply=Reply.REJECTED, reply_on=date(2026, 10, 20), io_reviewed=True)
    assert t.escalation_opens == date(2026, 10, 2)
    assert t.escalation_deadline == date(2027, 1, 18)    # 20 Oct + 90 days


def test_india_window_closed_after_90_days():
    t = india_timeline(date(2026, 1, 1), today=date(2026, 9, 26))
    assert t.stage == "window_closed"
    assert _ms(t, "ombudsman_deadline").state == "missed"
    assert t.escalation_deadline == date(2026, 5, 1)    # 31 Jan + 90 days
    assert t.days_left < 0


def test_india_fixed():
    t = india_timeline(date(2026, 9, 1), today=date(2026, 9, 26),
                       reply=Reply.FIXED, reply_on=date(2026, 9, 15))
    assert t.stage == "fixed"
    assert t.escalation_deadline is None


def test_india_counts_from_delivery_when_given():
    t = india_timeline(date(2026, 9, 1), today=date(2026, 9, 26), received_on=date(2026, 9, 5))
    assert _ms(t, "reply").day == date(2026, 10, 5)
    assert not t.notes


@pytest.mark.parametrize("kw, msg", [
    (dict(sent_on=date(2026, 10, 1)), "future"),
    (dict(received_on=date(2026, 8, 1)), "before the date sent"),
    (dict(reply=Reply.REJECTED, reply_on=date(2026, 8, 1)), "before the complaint"),
    (dict(reply=Reply.REJECTED), "Still needed"),
])
def test_india_bad_dates(kw, msg):
    args = dict(sent_on=date(2026, 9, 1), today=date(2026, 9, 26))
    args.update(kw)
    with pytest.raises(TimelineInputError, match=msg):
        india_timeline(**args)


# ── US business days ────────────────────────────────────────────────────────

def test_us_holidays_2026_observed_dates():
    h = us_legal_public_holidays(2026)
    assert date(2026, 7, 3) in h        # 4 July is a Saturday
    assert date(2026, 11, 26) in h      # Thanksgiving
    assert date(2026, 1, 19) in h       # MLK Day
    assert len(h) == 11


def test_new_year_on_saturday_is_observed_the_friday_before():
    # 1 Jan 2028 is a Saturday.
    assert add_business_days(date(2027, 12, 30), 1) == date(2028, 1, 3)


def test_add_business_days_skips_weekend_and_holiday():
    assert add_business_days(date(2026, 7, 2), 5) == date(2026, 7, 10)


# ── US mortgage notice of error ─────────────────────────────────────────────

def test_respa_clocks():
    t = us_notice_of_error_timeline(date(2026, 9, 28), today=date(2026, 9, 28))
    assert _ms(t, "ack").day == date(2026, 10, 5)
    # 30 business days, skipping Columbus Day (12 Oct).
    assert _ms(t, "response").day == date(2026, 11, 10)
    assert t.stage == "awaiting_reply"


def test_respa_extension_and_overdue():
    t = us_notice_of_error_timeline(date(2026, 9, 28), today=date(2026, 12, 20), extended=True)
    assert _ms(t, "response_ext").day == add_business_days(date(2026, 11, 10), 15)
    assert t.stage == "overdue"
    assert "consumerfinance.gov" in t.next_action


# ── US card billing error ───────────────────────────────────────────────────

def test_fcba_on_time():
    t = us_billing_error_timeline(date(2026, 8, 1), date(2026, 9, 15), today=date(2026, 9, 26),
                                  received_on=date(2026, 9, 20))
    assert _ms(t, "notice_by").day == date(2026, 9, 30)
    assert _ms(t, "ack").day == date(2026, 10, 20)
    assert _ms(t, "resolve").day == date(2026, 12, 19)
    assert t.stage == "awaiting_reply"


def test_fcba_late_notice_is_flagged():
    t = us_billing_error_timeline(date(2026, 6, 1), date(2026, 9, 1), today=date(2026, 9, 26))
    assert t.stage == "late_notice"
    assert _ms(t, "notice_by").state == "missed"
