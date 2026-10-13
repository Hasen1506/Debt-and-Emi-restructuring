"""/api/notify/*: payday email loop and deadline reminders.

Signed in (session cookie):
  GET  /api/notify/flags                  which notifications this server offers (no sign-in)
  GET  /api/notify/settings               this user's settings
  PUT  /api/notify/payday                 {on, day, snapshot}: turn on/off, refresh the payment list
  PUT  /api/notify/reminders              {on, items}: deadline reminders
  GET  /api/notify/answers                answers from email links/replies, not yet applied in the app
  POST /api/notify/answers/{id}/applied   the app has shown / applied it

From an email (signed link, no sign-in):
  GET  /api/notify/ack?t=...              a confirm page (changes nothing: mail scanners open links)
  POST /api/notify/ack                    records the answer
  GET/POST /api/notify/unsubscribe?t=...  turn every email off (POST is RFC 8058 one-click)

Scheduler (Authorization: Bearer NOTIFY_CRON_SECRET):
  POST /api/notify/run                    send what is due today
  GET  /api/notify/metrics                D30 / D60 return among opted-in users

Resend webhook: POST /api/notify/inbound  a "done" reply (PAYDAY_REPLY_INBOUND=true)

Every route answers 404 while its flag is off.
"""
from __future__ import annotations

import html
import hmac
import logging
import os
import secrets
from dataclasses import dataclass
from datetime import date, datetime
from typing import Annotated, Any, Callable, Optional
from zoneinfo import ZoneInfo

from urllib.parse import parse_qs

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field

from api.notify import flags, inbound, sender, tokens
from api.notify.store import store
from engine import payday, reminders, retention

log = logging.getLogger(__name__)
router = APIRouter(prefix="/notify", tags=["notify"])

ZONES = {"IN": "Asia/Kolkata", "US": "America/New_York"}


def _today(country: str = "IN") -> date:
    return datetime.now(ZoneInfo(ZONES.get(country, "Asia/Kolkata"))).date()


# Tests pin the clock.
today_fn: Callable[[str], date] = _today


@dataclass(frozen=True)
class NotifyUser:
    id: str
    email: str


async def notify_user(request: Request) -> NotifyUser:
    """The signed-in user. Sign-in needs the database; without it, 503."""
    from api.db.database import SessionLocal, db_enabled

    if not db_enabled() or SessionLocal is None:
        raise HTTPException(503, "Sign-in isn't available on this server, so notifications aren't either.")
    from api.auth.dependencies import _load_user_from_cookie
    from api.auth.session import SESSION_COOKIE_NAME

    async with SessionLocal() as db:
        user = await _load_user_from_cookie(request.cookies.get(SESSION_COOKIE_NAME), db)
    if user is None:
        raise HTTPException(401, "Sign in to turn on emails.")
    return NotifyUser(id=str(user.id), email=user.email)


def _need(on: bool) -> None:
    if not on:
        raise HTTPException(404, "Not available.")


# ── settings ────────────────────────────────────────────────────────────────

@router.get("/flags")
def get_flags() -> dict[str, bool]:
    return {
        "payday_email": flags.payday_enabled(),
        "deadline_reminders": flags.reminders_enabled(),
        "reply_done": flags.inbound_enabled(),
    }


@router.get("/settings")
async def get_settings(user: Annotated[NotifyUser, Depends(notify_user)]) -> dict[str, Any]:
    _need(flags.any_enabled())
    s = await store().get(user.id)
    return {
        "payday": {
            "available": flags.payday_enabled(),
            "on": bool(s and s["payday_on"]),
            "day": s["payday_day"] if s else None,
            "list_month": (s["snapshot"] or {}).get("month") if s else None,
            "list_saved_at": s["snapshot_at"].isoformat() if s and s.get("snapshot_at") else None,
        },
        "reminders": {
            "available": flags.reminders_enabled(),
            "on": bool(s and s["reminders_on"]),
            "count": len(s["reminder_items"]) if s else 0,
        },
        "email": user.email,
    }


class PaydayIn(BaseModel):
    on: bool
    day: Optional[int] = Field(default=None, ge=1, le=31)
    snapshot: Optional[dict[str, Any]] = None


@router.put("/payday")
async def put_payday(body: PaydayIn, user: Annotated[NotifyUser, Depends(notify_user)]) -> dict[str, Any]:
    _need(flags.payday_enabled())
    snap_json = None
    if body.on:
        if body.day is None:
            raise HTTPException(422, {"field": "day", "message": "Which day of the month is your salary paid?"})
        if body.snapshot is not None:
            try:
                snap = payday.parse_snapshot(body.snapshot)
            except payday.SnapshotError as e:
                raise HTTPException(422, {"field": "snapshot", "message": str(e)}) from None
            snap_json = payday.snapshot_to_json(snap)
    country = (body.snapshot or {}).get("country", "IN")
    await store().set_payday(user.id, user.email, on=body.on, day=body.day if body.on else None,
                             snapshot=snap_json, today=today_fn(country))
    return {"ok": True, "on": body.on}


class ReminderItemIn(BaseModel):
    key: str = Field(max_length=40)
    label: str = Field(max_length=120)
    day: date
    state: Optional[str] = None


class RemindersIn(BaseModel):
    on: bool
    # The complaint tracker and the closure letter each send their own
    # list; one replaces only its own items.
    source: str = Field(default="complaint", pattern="^(complaint|closure)$")
    items: list[ReminderItemIn] = Field(default_factory=list, max_length=reminders.MAX_ITEMS)


@router.put("/reminders")
async def put_reminders(body: RemindersIn, user: Annotated[NotifyUser, Depends(notify_user)]) -> dict[str, Any]:
    _need(flags.reminders_enabled())
    mine = [
        {"key": i.key, "label": " ".join(i.label.split()), "day": i.day.isoformat(), "source": body.source,
         "state": i.state or "upcoming"}
        for i in body.items
    ]
    cur = await store().get(user.id)
    others = [i for i in (cur["reminder_items"] if cur else []) if i.get("source") != body.source]
    items = (others + mine)[: reminders.MAX_ITEMS] if body.on else others
    await store().set_reminders(user.id, user.email, on=bool(items), items=items)
    upcoming = reminders.schedule(
        [reminders.Item(i["key"], i["label"], date.fromisoformat(i["day"]), i["source"],
                        done=i["state"] in ("done", "missed")) for i in items],
        today=today_fn("IN"),
    ) if body.on else []
    nxt = upcoming[0] if upcoming else None
    return {"ok": True, "on": body.on, "next": {"send_on": nxt.send_on.isoformat(), "text": nxt.text} if nxt else None}


@router.get("/answers")
async def get_answers(user: Annotated[NotifyUser, Depends(notify_user)]) -> dict[str, Any]:
    _need(flags.payday_enabled())
    return {"answers": await store().pending_answers(user.id)}


@router.post("/answers/{event_id}/applied")
async def answer_applied(event_id: int, user: Annotated[NotifyUser, Depends(notify_user)]) -> dict[str, bool]:
    _need(flags.payday_enabled())
    if not await store().mark_applied(user.id, event_id):
        raise HTTPException(404, "Not found.")
    return {"ok": True}


# ── pages opened from an email ──────────────────────────────────────────────

ACK_TEXT = {
    "all": ("All paid", "Record that you paid everything on this month's list?"),
    "some": ("Paid some of it", "Record that you paid some of this month's list? Open RightDue afterwards "
                                "to say which ones."),
    "cant": ("I can't pay this month", "Record that you can't pay this month? RightDue will show what to "
                                       "protect first when you open it."),
}
ACK_KIND = {"all": "ack_all", "some": "ack_some", "cant": "ack_cant"}


PAGE_CSP = "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'"


def _page(title: str, body: str, status: int = 200) -> HTMLResponse:
    doc = (
        "<!doctype html><html lang='en'><head><meta charset='utf-8'>"
        "<meta name='viewport' content='width=device-width,initial-scale=1'>"
        "<meta name='robots' content='noindex'>"
        f"<title>{html.escape(title)} · RightDue</title></head>"
        "<body style='font-family:system-ui,sans-serif;max-width:32rem;margin:3rem auto;padding:0 1rem;"
        "line-height:1.6;color:#111'>"
        f"<h1 style='font-size:1.3rem'>{html.escape(title)}</h1>{body}</body></html>"
    )
    return HTMLResponse(doc, status_code=status, headers={
        "Cache-Control": "no-store", "Referrer-Policy": "no-referrer",
        # api/security.py gives /api/* "default-src 'none'"; these confirm
        # pages are HTML with inline style attributes and a same-origin form
        # (integration: G8 CSP x G7 pages). No scripts are allowed.
        "Content-Security-Policy": PAGE_CSP,
    })


def _bad_link(msg: str) -> HTMLResponse:
    return _page("This link didn't work", f"<p>{html.escape(msg)}</p>"
                 f"<p><a href='{html.escape(flags.app_url())}'>Open RightDue</a></p>", 400)


def _month_label(month: str) -> str:
    try:
        return datetime.strptime(month, "%Y-%m").strftime("%B %Y")
    except ValueError:
        return month


@router.get("/ack", response_class=HTMLResponse)
def ack_page(t: str = Query(..., max_length=400)) -> HTMLResponse:
    _need(flags.payday_enabled())
    try:
        c = tokens.verify(t)
    except tokens.TokenError as e:
        return _bad_link(str(e))
    if c.action not in ACK_TEXT:
        return _bad_link("This link isn't valid.")
    title, ask = ACK_TEXT[c.action]
    return _page(f"{title} · {_month_label(c.month)}", (
        f"<p>{html.escape(ask)}</p>"
        "<form method='post' action='ack'>"
        f"<input type='hidden' name='t' value='{html.escape(t)}'>"
        "<button type='submit' style='padding:10px 16px;font-weight:600'>Yes, record it</button></form>"
        "<p style='color:#555;font-size:14px'>Nothing is recorded until you press the button.</p>"
    ))


@router.post("/ack", response_class=HTMLResponse)
async def ack_record(request: Request) -> HTMLResponse:
    _need(flags.payday_enabled())
    # A plain HTML form post (application/x-www-form-urlencoded); read by
    # hand so the API needs no multipart dependency.
    raw = (await request.body())[:2000].decode("utf-8", "replace")
    t = (parse_qs(raw).get("t") or [""])[0]
    try:
        c = tokens.verify(t)
    except tokens.TokenError as e:
        return _bad_link(str(e))
    if c.action not in ACK_KIND:
        return _bad_link("This link isn't valid.")
    sub = await store().get(c.user_id)
    if sub is None:
        return _bad_link("We couldn't find your settings. Open RightDue to record it there.")
    await store().add_event(c.user_id, ACK_KIND[c.action], c.month, today_fn((sub["snapshot"] or {}).get("country", "IN")))
    next_step = {
        "all": "Next time you open RightDue, it will ask you to confirm these in Pay this month.",
        "some": "Open RightDue and mark the ones that went out in Pay this month.",
        "cant": "Open RightDue: Home's \u201cFeeling overwhelmed?\u201d shows which payment to protect first.",
    }[c.action]
    return _page("Recorded", f"<p>{html.escape(next_step)}</p>"
                 f"<p><a href='{html.escape(flags.app_url())}'>Open RightDue</a></p>")


@router.get("/unsubscribe", response_class=HTMLResponse)
def unsubscribe_page(t: str = Query(..., max_length=400)) -> HTMLResponse:
    _need(flags.any_enabled())
    try:
        c = tokens.verify(t)
    except tokens.TokenError as e:
        return _bad_link(str(e))
    if c.action != "unsub":
        return _bad_link("This link isn't valid.")
    return _page("Turn off RightDue emails?", (
        "<p>This stops payday emails and deadline reminders. You can turn them on again in the app.</p>"
        f"<form method='post' action='unsubscribe?t={html.escape(t)}'>"
        "<button type='submit' style='padding:10px 16px;font-weight:600'>Turn them off</button></form>"
    ))


@router.post("/unsubscribe", response_class=HTMLResponse)
async def unsubscribe(t: str = Query(..., max_length=400)) -> HTMLResponse:
    # Also the RFC 8058 one-click target (List-Unsubscribe-Post).
    _need(flags.any_enabled())
    try:
        c = tokens.verify(t)
    except tokens.TokenError as e:
        return _bad_link(str(e))
    if c.action != "unsub":
        return _bad_link("This link isn't valid.")
    await store().unsubscribe(c.user_id)
    return _page("Emails turned off", "<p>You won't get payday emails or reminders from RightDue. "
                 "The saved payment list was deleted.</p>")


# ── scheduler ───────────────────────────────────────────────────────────────

def _cron(authorization: Optional[str]) -> None:
    secret = os.environ.get("NOTIFY_CRON_SECRET", "")
    given = (authorization or "").removeprefix("Bearer ").strip()
    if len(secret) < 16 or not hmac.compare_digest(given, secret):
        raise HTTPException(401, "Not authorised.")


def _links(user_id: str, month: str) -> dict[str, str]:
    base = f"{flags.app_url()}/api/notify"
    return {
        "all_paid": f"{base}/ack?t={tokens.sign(user_id, month, 'all')}",
        "some_paid": f"{base}/ack?t={tokens.sign(user_id, month, 'some')}",
        "cant_pay": f"{base}/ack?t={tokens.sign(user_id, month, 'cant')}",
        "open_app": f"{flags.app_url()}/",
        "unsubscribe": f"{base}/unsubscribe?t={tokens.sign(user_id, '-', 'unsub')}",
    }


def _unsub_headers(url: str) -> dict[str, str]:
    return {"List-Unsubscribe": f"<{url}>", "List-Unsubscribe-Post": "List-Unsubscribe=One-Click"}


async def _send_payday(sub: dict, today: date) -> str:
    snap_json = sub.get("snapshot")
    if not snap_json:
        return "no_list"
    pd = payday.due_payday(today, int(sub["payday_day"]), sub.get("last_sent_month"))
    if pd is None:
        return "not_due"
    snap = payday.parse_snapshot(snap_json)
    month = f"{today:%Y-%m}"
    links = _links(sub["user_id"], month)
    code = None
    reply_to = None
    if flags.inbound_enabled() and os.environ.get("NOTIFY_REPLY_TO", "").count("@") == 1:
        code = secrets.token_hex(6)
        local, domain = os.environ["NOTIFY_REPLY_TO"].split("@")
        reply_to = f"{local}+{code}@{domain}"
    d = payday.build_digest(snap, today=today, links=links, reply_enabled=reply_to is not None)
    ok = sender.send(sender.Message(sub["email"], d.subject, d.html, d.text,
                                    _unsub_headers(links["unsubscribe"]), reply_to))
    if not ok:
        return "not_sent"
    await store().mark_sent(sub["user_id"], month, today, code)
    return "sent"


async def _send_reminders(sub: dict, today: date) -> int:
    items = [reminders.Item(i["key"], i["label"], date.fromisoformat(i["day"]), i.get("source", "complaint"),
                            done=i.get("state") in ("done", "missed")) for i in sub["reminder_items"]]
    due = [r for r in reminders.due_on(reminders.schedule(items, today=today), today)
           if f"{r.key}|{r.send_on.isoformat()}" not in sub["reminders_sent"]]
    if not due:
        return 0
    unsub = f"{flags.app_url()}/api/notify/unsubscribe?t={tokens.sign(sub['user_id'], '-', 'unsub')}"
    lines = [r.text for r in due]
    subject = due[0].text if len(due) == 1 else f"{len(due)} dates to know about today"
    text = "\n\n".join([*lines, f"Open RightDue: {flags.app_url()}/tools/loan-check",
                        f"Turn these emails off: {unsub}"])
    body = "".join(f"<p>{html.escape(x)}</p>" for x in lines) + (
        f"<p><a href='{html.escape(flags.app_url())}/tools/loan-check'>Open RightDue</a></p>"
        f"<p style='font-size:12px;color:#666'><a href='{html.escape(unsub)}'>Turn these emails off</a></p>")
    if not sender.send(sender.Message(sub["email"], subject[:120], body, text, _unsub_headers(unsub))):
        return 0
    await store().mark_reminders_sent(sub["user_id"], [f"{r.key}|{r.send_on.isoformat()}" for r in due])
    await store().add_event(sub["user_id"], "reminder", None, today)
    return len(due)


@router.post("/run")
async def run(authorization: Annotated[Optional[str], Header()] = None) -> dict[str, Any]:
    _need(flags.any_enabled())
    _cron(authorization)
    counts: dict[str, int] = {}
    reminders_sent = 0
    for sub in await store().active():
        country = (sub.get("snapshot") or {}).get("country", "IN")
        today = today_fn(country)
        try:
            if flags.payday_enabled() and sub["payday_on"]:
                r = await _send_payday(sub, today)
                counts[r] = counts.get(r, 0) + 1
            if flags.reminders_enabled() and sub["reminders_on"]:
                reminders_sent += await _send_reminders(sub, today)
        except Exception:                       # one bad row must not stop the rest
            log.exception("notify run failed for one subscriber")
            counts["error"] = counts.get("error", 0) + 1
    return {"payday": counts, "reminders_sent": reminders_sent}


@router.get("/metrics")
async def metrics(authorization: Annotated[Optional[str], Header()] = None) -> dict[str, Any]:
    _need(flags.payday_enabled())
    _cron(authorization)
    evs = await store().all_events()
    subs = await store().active()
    opted = {s["user_id"]: s["opted_in_on"] for s in subs if s.get("opted_in_on")}
    rates = retention.return_rates(opted, [retention.Event(u, k, d) for u, k, d in evs], today_fn("IN"))
    return {"rates": [{"window": r.window, "eligible": r.eligible, "returned": r.returned, "share": r.share}
                      for r in rates]}


# ── inbound reply ───────────────────────────────────────────────────────────

@router.post("/inbound")
async def inbound_reply(request: Request) -> dict[str, Any]:
    _need(flags.inbound_enabled())
    body = await request.body()
    try:
        inbound.verify_signature(body, {k.lower(): v for k, v in request.headers.items()})
    except inbound.InboundError:
        raise HTTPException(401, "Bad signature.") from None
    event = await request.json()
    if event.get("type") != "email.received":
        return {"ok": True, "ignored": "type"}
    data = event.get("data") or {}
    code = inbound.reply_code(list(data.get("to") or []))
    sub = await store().by_reply_code(code) if code else None
    if sub is None or not sub.get("last_sent_month"):
        return {"ok": True, "ignored": "unknown"}
    try:
        received = inbound.fetch_received(str(data.get("email_id", "")))
    except Exception:
        log.exception("could not fetch received email")
        raise HTTPException(502, "Could not read the reply.") from None
    if not inbound.sender_trusted(received, sub["email"]):
        return {"ok": True, "ignored": "sender"}
    said = payday.reply_says_done(str(received.get("text") or ""))
    if said is None:
        return {"ok": True, "ignored": "unclear"}
    country = (sub.get("snapshot") or {}).get("country", "IN")
    await store().add_event(sub["user_id"], "reply_done" if said else "reply_not",
                            sub["last_sent_month"], today_fn(country))
    return {"ok": True, "recorded": "done" if said else "not_paid"}
