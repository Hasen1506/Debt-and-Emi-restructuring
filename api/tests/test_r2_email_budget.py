"""Round 2 (15 Oct 2026): one shared Resend Free budget for every email.

Guards the CLASS of defect "notifications eat sign-in codes' share" and
"a deferred email is lost or jumps the queue", not single repros:
  * plan(): for every mix of counts, codes already sent + the reserve still
    held + notification room never exceeds the daily or monthly limit;
  * codes are never refused by this budget (only counted);
  * the run sends in the fair order (deadline reminders first, then
    payday / rate-move, oldest due first) and the rest roll to the next day;
  * a reminder that missed its day still goes out the next day, worded for
    that day, once.
"""
from __future__ import annotations

import itertools
from datetime import date

import pytest
from fastapi.testclient import TestClient

from api.main import app
from api.notify import budget, queue, routes, sender
from api.notify import store as nstore
from engine import reminders

KEY = "k" * 40
CRON = "c" * 24
AUTH = {"Authorization": f"Bearer {CRON}"}
SNAP = {
    "month": "2026-11", "made_on": "2026-10-30", "country": "IN", "currency": "INR",
    "rows": [{"name": "HDFC credit card", "amount": "18500", "kind": "extra"}],
}
ENV_KEYS = ("NOTIFY_DAILY_CAP", "RESEND_DAILY_LIMIT", "RESEND_MONTHLY_LIMIT", "RESEND_CODE_RESERVE",
            "OTP_GLOBAL_DAILY_CAP")


# ── plan(): the arithmetic ──────────────────────────────────────────────────

def test_defaults_are_resend_free_with_headroom():
    assert budget.limits({}) == (95, 3000)
    assert budget.limits({"RESEND_DAILY_LIMIT": "0"}) == (None, None)          # paid plan: no limits
    assert budget.limits({"RESEND_DAILY_LIMIT": "0", "RESEND_MONTHLY_LIMIT": "50000"}) == (None, 50000)
    assert budget.limits({"RESEND_MONTHLY_LIMIT": "0"}) == (95, None)
    assert budget.DEFAULT_DAILY_LIMIT < budget.RESEND_FREE_DAILY


@pytest.mark.parametrize("codes_today,codes_yesterday,notify_today", list(itertools.product(
    (0, 5, 19, 20, 40, 95, 120), (0, 10, 30, 90), (0, 10, 75, 95))))
def test_room_never_takes_the_codes_share(codes_today, codes_yesterday, notify_today):
    c = budget.Counts(today=date(2026, 11, 30), codes_today=codes_today, codes_yesterday=codes_yesterday,
                      codes_month=codes_today * 30, notify_today=notify_today, notify_month=notify_today)
    p = budget.plan(c, {})
    reserve = max(20, codes_yesterday)
    assert p.code_reserve_today == reserve
    assert p.code_reserve_left == max(0, reserve - codes_today)
    assert p.room is not None and p.room >= 0
    # Never past the day's limit once codes and the held reserve are counted.
    if p.room > 0:
        assert codes_today + notify_today + p.code_reserve_left + p.room <= 95


@pytest.mark.parametrize("day", [1, 10, 15, 28, 30])
@pytest.mark.parametrize("codes_month,notify_month", [(0, 0), (300, 1200), (600, 2000), (1500, 1400)])
def test_monthly_guard_keeps_codes_for_the_rest_of_the_month(day, codes_month, notify_month):
    today = date(2026, 11, day)                     # November: 30 days
    c = budget.Counts(today=today, codes_month=codes_month, notify_month=notify_month)
    p = budget.plan(c, {})
    per_day = max(20, -(-codes_month // day))
    assert p.future_code_reserve == (30 - day) * per_day
    total = codes_month + notify_month + p.code_reserve_left + p.future_code_reserve + (p.room or 0)
    if p.room:
        assert total <= 3000


def test_notify_daily_cap_is_an_extra_ceiling_only():
    c = budget.Counts(today=date(2026, 11, 30), notify_today=3)
    assert budget.plan(c, {"NOTIFY_DAILY_CAP": "5"}).room == 2
    assert budget.plan(c, {"NOTIFY_DAILY_CAP": "500"}).room == 95 - 20 - 3
    assert budget.plan(c, {"RESEND_DAILY_LIMIT": "0"}).room is None
    assert budget.plan(c, {"RESEND_DAILY_LIMIT": "0", "NOTIFY_DAILY_CAP": "50"}).room == 47


def test_busy_sign_in_day_leaves_notifications_nothing():
    c = budget.Counts(today=date(2026, 11, 30), codes_today=80, codes_yesterday=90, notify_today=0)
    assert budget.plan(c, {}).room == 5          # 95 − 80 − (90 − 80 still held)
    c = budget.Counts(today=date(2026, 11, 30), codes_today=96)
    assert budget.plan(c, {}).room == 0


def test_codes_are_never_refused_by_the_shared_budget():
    """Codes go through api/auth's own caps only: nothing in the sign-in
    route consults api/notify/budget."""
    import inspect
    from api.auth import routes as auth_routes
    assert "notify.budget" not in inspect.getsource(auth_routes)
    assert "budget_mod" not in inspect.getsource(auth_routes)


def test_ist_day_bounds_are_india_midnights():
    a, b = budget.ist_day_bounds(date(2026, 11, 1))
    assert a.isoformat() == "2026-10-31T18:30:00+00:00" and (b - a).days == 1


# ── queue: fair order and reminder rollover ─────────────────────────────────

def test_order_deadlines_first_then_oldest():
    c = [
        queue.Candidate(queue.CLASS_OTHER, date(2026, 11, 1), "a", "payday"),
        queue.Candidate(queue.CLASS_OTHER, date(2026, 10, 30), "z", "rate_move"),
        queue.Candidate(queue.CLASS_DEADLINE, date(2026, 11, 2), "m", "reminders"),
        queue.Candidate(queue.CLASS_DEADLINE, date(2026, 10, 31), "n", "reminders"),
    ]
    assert [(x.user_id, x.kind) for x in queue.order(c)] == [
        ("n", "reminders"), ("m", "reminders"), ("z", "rate_move"), ("a", "payday")]


def test_missed_reminder_rolls_over_worded_for_the_day_it_goes():
    it = reminders.Item("ombudsman_deadline", "last day to file with the RBI Ombudsman", date(2026, 11, 10))
    # The 7-day reminder was due 3 Nov; nothing was sent. On 4 Nov it goes, as "In 6 days".
    due = queue.due_reminders([it], date(2026, 11, 4), sent=[])
    assert len(due) == 1
    d = due[0]
    assert d.reminder.text.startswith("In 6 days") and d.due_since == date(2026, 11, 3)
    assert d.sent_keys == ("ombudsman_deadline|2026-11-03",)
    # Both the 7-day and the 1-day reminder missed: one email, worded for today, both marked.
    due = queue.due_reminders([it], date(2026, 11, 9), sent=[])
    assert len(due) == 1 and due[0].reminder.text.startswith("Tomorrow")
    assert set(due[0].sent_keys) == {"ombudsman_deadline|2026-11-03", "ombudsman_deadline|2026-11-09"}
    # Once sent, nothing again.
    assert queue.due_reminders([it], date(2026, 11, 9), sent=due[0].sent_keys) == []


def test_before_reminder_for_a_past_date_is_dropped_and_old_ones_expire():
    it = reminders.Item("ombudsman_deadline", "last day to file", date(2026, 11, 10))
    assert queue.due_reminders([it], date(2026, 11, 11), sent=[]) == []
    lender = reminders.Item("reply", "the bank's reply was due", date(2026, 11, 1))
    assert len(queue.due_reminders([lender], date(2026, 11, 5), sent=[])) == 1      # day-after reminder rolls
    assert queue.due_reminders([lender], date(2026, 11, 2 + queue.ROLLOVER_DAYS + 1), sent=[]) == []


# ── the run: sends in order, rolls the rest ─────────────────────────────────

@pytest.fixture()
def env(tmp_path, monkeypatch):
    for k, v in {"PAYDAY_EMAIL_ENABLED": "true", "DEADLINE_REMINDERS_ENABLED": "true",
                 "RATE_MOVE_EMAIL_ENABLED": "false", "NOTIFY_SIGNING_KEY": KEY, "NOTIFY_CRON_SECRET": CRON,
                 "PUBLIC_APP_URL": "https://rightdue.test"}.items():
        monkeypatch.setenv(k, v)
    for k in ENV_KEYS:
        monkeypatch.delenv(k, raising=False)
    codes = {"n": (0, 0, 0)}

    async def code_counts(day):
        return codes["n"]
    monkeypatch.setattr(budget, "code_counts_fn", code_counts)
    s = nstore.NotifyStore(nstore.sqlite_engine(tmp_path / "n.sqlite3"))
    nstore.set_store(s)
    sent: list[sender.Message] = []
    sender.set_sender(lambda m: sent.append(m) or True)
    clock = {"today": date(2026, 10, 30)}
    monkeypatch.setattr(routes, "today_fn", lambda country="IN": clock["today"])
    who = {"u": routes.NotifyUser("u1", "u1@example.com")}
    app.dependency_overrides[routes.notify_user] = lambda: who["u"]
    yield {"sent": sent, "clock": clock, "client": TestClient(app), "who": who, "codes": codes}
    app.dependency_overrides.pop(routes.notify_user, None)
    sender.set_sender(None)
    nstore.set_store(None)


def _as(env, uid):
    env["who"]["u"] = routes.NotifyUser(uid, f"{uid}@example.com")


def _payday(env, uid, day):
    _as(env, uid)
    assert env["client"].put("/api/notify/payday", json={"on": True, "day": day, "snapshot": SNAP}).status_code == 200


def _reminder(env, uid, day):
    _as(env, uid)
    r = env["client"].put("/api/notify/reminders", json={"on": True, "items": [
        {"key": "ombudsman_deadline", "label": "last day to file with the RBI Ombudsman", "day": day}]})
    assert r.status_code == 200


def test_deadline_reminders_go_before_payday_when_short(env):
    _payday(env, "p1", 1)
    _payday(env, "p2", 1)
    _reminder(env, "r1", "2026-11-02")             # 1-day reminder on 1 Nov
    # Room for exactly two notifications: 95 − 93 codes already sent today (the 20 held are used up).
    env["codes"]["n"] = (93, 0, 93)
    env["clock"]["today"] = date(2026, 11, 1)
    r = env["client"].post("/api/notify/run", headers=AUTH).json()
    assert r["budget"]["allowance"] == 2
    assert [m.to for m in env["sent"]] == ["r1@example.com", "p1@example.com"]
    assert r["budget"]["deferred_by"] == {"payday": 1}
    # Next day the deferred payday email goes out too.
    env["codes"]["n"] = (0, 93, 93)               # yesterday's 93 codes are held today: room 2 again
    env["clock"]["today"] = date(2026, 11, 2)
    env["client"].post("/api/notify/run", headers=AUTH)
    # The day-of deadline reminder still goes first (class beats age), then the deferred payday email.
    assert [m.to for m in env["sent"]][2:] == ["r1@example.com", "p2@example.com"]


def test_older_payday_goes_before_newer_one(env):
    _payday(env, "late", 3)
    _payday(env, "early", 1)
    env["codes"]["n"] = (94, 0, 94)               # room for one
    env["clock"]["today"] = date(2026, 11, 3)
    env["client"].post("/api/notify/run", headers=AUTH)
    assert [m.to for m in env["sent"]] == ["early@example.com"]


def test_deferred_reminder_is_sent_next_day_once(env):
    _reminder(env, "r1", "2026-11-10")
    env["codes"]["n"] = (95, 0, 95)               # no room on the 7-day reminder's day
    env["clock"]["today"] = date(2026, 11, 3)
    r = env["client"].post("/api/notify/run", headers=AUTH).json()
    assert env["sent"] == [] and r["budget"]["deferred_by"] == {"reminders": 1}
    env["codes"]["n"] = (0, 0, 95)
    env["clock"]["today"] = date(2026, 11, 4)
    env["client"].post("/api/notify/run", headers=AUTH)
    env["client"].post("/api/notify/run", headers=AUTH)
    assert len(env["sent"]) == 1 and env["sent"][0].subject.startswith("In 6 days")


def test_status_reports_the_shared_budget(env):
    env["codes"]["n"] = (10, 30, 100)
    env["clock"]["today"] = date(2026, 11, 30)
    j = env["client"].get("/api/notify/status", headers=AUTH).json()["budget"]
    assert j["daily_limit"] == 95 and j["code_reserve_today"] == 30 and j["code_reserve_left"] == 20
    assert j["allowance_today"] == 95 - 10 - 20
