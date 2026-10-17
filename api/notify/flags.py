"""Feature flags for notifications. All default to off.

PAYDAY_EMAIL_ENABLED=true       payday email + "did you pay?" links
DEADLINE_REMINDERS_ENABLED=true complaint / closure deadline reminder emails
RATE_MOVE_EMAIL_ENABLED=true    A13: after an RBI repo move, an email per opted-in
                                user with their repo-linked loans' new EMI / tenure
PAYDAY_REPLY_INBOUND=true       also accept a "done" reply (Resend inbound)
WHATSAPP_ENABLED                 reserved; not built (docs/retention/WHATSAPP.md)

Needed when any flag is on:
NOTIFY_SIGNING_KEY   secret for the signed links (32+ random bytes)
NOTIFY_CRON_SECRET   bearer token the scheduler sends to /api/notify/run
PUBLIC_APP_URL       e.g. https://rightdue.app (links in emails)
RESEND_API_KEY / RESEND_FROM (already used for sign-in codes)
RESEND_WEBHOOK_SECRET  (only with PAYDAY_REPLY_INBOUND) the whsec_... secret
NOTIFY_REPLY_TO        (only with PAYDAY_REPLY_INBOUND) e.g. reply@in.rightdue.app

Shared email budget (api/notify/budget.py): RESEND_DAILY_LIMIT (default 95,
under Resend Free's 100; 0 = no daily limit), RESEND_MONTHLY_LIMIT (default
3000 on Free), RESEND_CODE_RESERVE (default 20 held for sign-in codes),
NOTIFY_DAILY_CAP (optional extra ceiling on notifications).
"""
from __future__ import annotations

import os


def _on(name: str) -> bool:
    return os.environ.get(name, "").strip().lower() == "true"


def payday_enabled() -> bool:
    return _on("PAYDAY_EMAIL_ENABLED")


def reminders_enabled() -> bool:
    return _on("DEADLINE_REMINDERS_ENABLED")


def rate_move_enabled() -> bool:
    return _on("RATE_MOVE_EMAIL_ENABLED")


def inbound_enabled() -> bool:
    return payday_enabled() and _on("PAYDAY_REPLY_INBOUND")


def any_enabled() -> bool:
    return payday_enabled() or reminders_enabled() or rate_move_enabled()


def app_url() -> str:
    return os.environ.get("PUBLIC_APP_URL", "http://localhost:3000").rstrip("/")


def missing_config() -> list[str]:
    """What stops emails going out, in plain words, for the founder's status
    check (GET /api/notify/status). Names only, never values."""
    out: list[str] = []
    if not any_enabled():
        out.append("No notification flag is true (PAYDAY_EMAIL_ENABLED / DEADLINE_REMINDERS_ENABLED / "
                   "RATE_MOVE_EMAIL_ENABLED).")
    if len(os.environ.get("NOTIFY_SIGNING_KEY", "")) < 32:
        out.append("NOTIFY_SIGNING_KEY is unset or shorter than 32 characters (email links can't be signed).")
    if len(os.environ.get("NOTIFY_CRON_SECRET", "")) < 16:
        out.append("NOTIFY_CRON_SECRET is unset or shorter than 16 characters (the scheduler can't call /run).")
    if not os.environ.get("PUBLIC_APP_URL", "").startswith("https://"):
        out.append("PUBLIC_APP_URL is not an https:// address (links in emails would point at localhost).")
    key = os.environ.get("RESEND_API_KEY", "")
    if not key or key.startswith("re_REPLACE"):
        out.append("RESEND_API_KEY is unset (nothing can be sent).")
    frm = os.environ.get("RESEND_FROM", "")
    if not frm or "resend.dev" in frm:
        out.append("RESEND_FROM is unset or the resend.dev sandbox, which only delivers to the Resend "
                   "account owner: use an address on the verified domain, e.g. RightDue <hello@rightdue.app>.")
    if not os.environ.get("DATABASE_URL"):
        out.append("DATABASE_URL is unset (settings need the database; signed-in routes answer 503).")
    if inbound_enabled():
        if not os.environ.get("RESEND_WEBHOOK_SECRET", "").startswith("whsec_"):
            out.append("PAYDAY_REPLY_INBOUND is on but RESEND_WEBHOOK_SECRET isn't a whsec_ secret.")
        if os.environ.get("NOTIFY_REPLY_TO", "").count("@") != 1:
            out.append("PAYDAY_REPLY_INBOUND is on but NOTIFY_REPLY_TO isn't an address.")
    return out
