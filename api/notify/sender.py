"""Send one notification email through Resend (the provider sign-in codes
already use). Tests and local runs swap the sender with `set_sender`.

Without a real RESEND_API_KEY nothing is sent: the message is logged
(subject and recipient only, never the amounts) and the call reports
"not sent", so the scheduler doesn't mark the month as done.
"""
from __future__ import annotations

import logging
import os
from dataclasses import dataclass, field
from typing import Callable, Optional

log = logging.getLogger(__name__)


@dataclass
class Message:
    to: str
    subject: str
    html: str
    text: str
    headers: dict[str, str] = field(default_factory=dict)
    reply_to: Optional[str] = None


def _resend_send(msg: Message) -> bool:
    key = os.environ.get("RESEND_API_KEY", "")
    if not key or key.startswith("re_REPLACE"):
        log.warning("Notification not sent (RESEND_API_KEY unset): %s", msg.subject[:40])
        return False
    import resend

    resend.api_key = key
    params = {
        "from": os.environ.get("RESEND_FROM", "onboarding@resend.dev"),
        "to": [msg.to],
        "subject": msg.subject,
        "html": msg.html,
        "text": msg.text,
        "headers": msg.headers,
    }
    if msg.reply_to:
        params["reply_to"] = msg.reply_to
    resend.Emails.send(params)
    return True


_sender: Callable[[Message], bool] = _resend_send


def send(msg: Message) -> bool:
    return _sender(msg)


def set_sender(fn: Optional[Callable[[Message], bool]]) -> None:
    global _sender
    _sender = fn or _resend_send
