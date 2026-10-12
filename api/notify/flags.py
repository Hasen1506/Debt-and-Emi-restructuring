"""Feature flags for notifications. All default to off.

PAYDAY_EMAIL_ENABLED=true       payday email + "did you pay?" links
DEADLINE_REMINDERS_ENABLED=true complaint / closure deadline reminder emails
PAYDAY_REPLY_INBOUND=true       also accept a "done" reply (Resend inbound)
WHATSAPP_ENABLED                 reserved; not built (docs/retention/WHATSAPP.md)

Needed when any flag is on:
NOTIFY_SIGNING_KEY   secret for the signed links (32+ random bytes)
NOTIFY_CRON_SECRET   bearer token the scheduler sends to /api/notify/run
PUBLIC_APP_URL       e.g. https://rightdue.app (links in emails)
RESEND_API_KEY / RESEND_FROM (already used for sign-in codes)
RESEND_WEBHOOK_SECRET  (only with PAYDAY_REPLY_INBOUND) the whsec_... secret
NOTIFY_REPLY_TO        (only with PAYDAY_REPLY_INBOUND) e.g. reply@in.rightdue.app
"""
from __future__ import annotations

import os


def _on(name: str) -> bool:
    return os.environ.get(name, "").strip().lower() == "true"


def payday_enabled() -> bool:
    return _on("PAYDAY_EMAIL_ENABLED")


def reminders_enabled() -> bool:
    return _on("DEADLINE_REMINDERS_ENABLED")


def inbound_enabled() -> bool:
    return payday_enabled() and _on("PAYDAY_REPLY_INBOUND")


def any_enabled() -> bool:
    return payday_enabled() or reminders_enabled()


def app_url() -> str:
    return os.environ.get("PUBLIC_APP_URL", "http://localhost:3000").rstrip("/")
