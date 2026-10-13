"""A "done" reply to the payday email (PAYDAY_REPLY_INBOUND=true).

Resend receives the reply (an MX record on a receiving subdomain), then
POSTs an `email.received` webhook. The webhook has no body, only metadata,
so we fetch the message from the Received emails API
(GET https://api.resend.com/emails/receiving/{id}).

Trust rules, all required:
1. The webhook signature checks out (Resend signs webhooks the Svix way:
   HMAC-SHA256 over "{svix-id}.{svix-timestamp}.{body}" with the base64
   secret after "whsec_"; the timestamp must be within 5 minutes).
2. It was sent to reply+<code>@..., the code of that user's latest
   payday email.
3. The From address is the subscriber's own, and Resend's own SPF/DKIM
   check reports DKIM or DMARC "pass" (a forged From fails these).
4. The first line the user typed says done / not paid
   (engine.payday.reply_says_done). Anything else records nothing.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import os
import re
import time
from email.utils import parseaddr
from typing import Optional

import httpx

TOLERANCE_SECONDS = 300
RECEIVED_URL = "https://api.resend.com/emails/receiving/{id}"


class InboundError(ValueError):
    pass


def verify_signature(body: bytes, headers: dict[str, str], *, now: Optional[float] = None,
                     secret: Optional[str] = None) -> None:
    secret = secret if secret is not None else os.environ.get("RESEND_WEBHOOK_SECRET", "")
    if not secret.startswith("whsec_"):
        raise InboundError("webhook secret not configured")
    msg_id = headers.get("svix-id", "")
    ts = headers.get("svix-timestamp", "")
    sigs = headers.get("svix-signature", "")
    if not (msg_id and ts and sigs):
        raise InboundError("missing signature headers")
    try:
        t = int(ts)
    except ValueError:
        raise InboundError("bad timestamp") from None
    if abs((now if now is not None else time.time()) - t) > TOLERANCE_SECONDS:
        raise InboundError("stale webhook")
    key = base64.b64decode(secret.removeprefix("whsec_"))
    want = base64.b64encode(hmac.new(key, f"{msg_id}.{ts}.".encode() + body, hashlib.sha256).digest()).decode()
    for part in sigs.split():
        version, _, sig = part.partition(",")
        if version == "v1" and hmac.compare_digest(sig, want):
            return
    raise InboundError("signature mismatch")


def reply_code(addresses: list[str]) -> Optional[str]:
    for a in addresses or []:
        m = re.search(r"\+([A-Za-z0-9]{8,16})@", parseaddr(a)[1] or a)
        if m:
            return m.group(1)
    return None


def fetch_received(email_id: str) -> dict:
    key = os.environ.get("RESEND_API_KEY", "")
    if not re.fullmatch(r"[A-Za-z0-9-]{8,64}", email_id or ""):
        raise InboundError("bad email id")
    r = httpx.get(RECEIVED_URL.format(id=email_id), headers={"Authorization": f"Bearer {key}"}, timeout=10)
    r.raise_for_status()
    return r.json()


def sender_trusted(received: dict, subscriber_email: str) -> bool:
    sender = parseaddr(str(received.get("from", "")))[1].lower()
    if sender != (subscriber_email or "").lower():
        return False
    auth = received.get("authentication") or {}
    return auth.get("dkim") == "pass" or auth.get("dmarc") == "pass"
