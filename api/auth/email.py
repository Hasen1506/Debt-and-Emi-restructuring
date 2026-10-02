"""Resend email delivery for OTP codes.

Production requires RESEND_API_KEY. Printing a code is available only
when local development explicitly sets OTP_DEV_MODE=true.
"""
from __future__ import annotations

import logging
import os

import resend

log = logging.getLogger(__name__)

OTP_SUBJECT = "Your RightDue sign-in code"


def _is_real_key(key: str | None) -> bool:
    return bool(key) and not key.startswith("re_REPLACE")


def _html_body(code: str) -> str:
    return (
        f"<p>Your sign-in code is:</p>"
        f"<p style='font-size:28px;letter-spacing:6px;font-weight:600;"
        f"font-family:monospace;'>{code}</p>"
        f"<p>It expires in 10 minutes. If you didn't request this, ignore "
        f"this email.</p>"
    )


def send_otp_email(to: str, code: str) -> None:
    api_key = os.environ.get("RESEND_API_KEY")
    if not _is_real_key(api_key):
        if os.environ.get("OTP_DEV_MODE") != "true":
            raise RuntimeError("Email delivery is not configured.")
        log.warning("RESEND_API_KEY not configured — printing OTP to stdout instead.")
        print(f"\n[DEV] OTP for {to}: {code}\n", flush=True)
        return

    resend.api_key = api_key
    from_addr = os.environ.get("RESEND_FROM", "onboarding@resend.dev")
    resend.Emails.send(
        {
            "from": from_addr,
            "to": [to],
            "subject": OTP_SUBJECT,
            "html": _html_body(code),
        }
    )
