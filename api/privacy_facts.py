"""Server-side copy of the privacy facts the notice states (audit80 D2, D5).

The notice itself is web/src/lib/privacy-facts.ts. The two must agree, and
api/tests/test_a80_trust.py fails when they don't (versions, and every
processor named here must be named there).

Versions: when the notice or terms change in a way that matters, bump the
version in BOTH files. Every signed-in user whose latest consent is for an
older version is then asked to agree again (GET /api/auth/me ->
consent_required), and the change-notice email (terms + notice promise) goes
only to users whose last agreement is older (consent_events).

Legal basis, read on meity.gov.in on 14 Oct 2026:
  DPDP Act 2023 s.6(10): where consent is the basis, the Data Fiduciary must
  prove the notice was given and consent was given.
  s.6(4): withdrawal as easy as giving. s.11(1)(b): identities of every Data
  Processor the data was shared with.
  https://www.meity.gov.in/static/uploads/2024/06/2bf1f0e9f04e6fb4f8fef35e82c42aa5.pdf
  These sections (and DPDP Rules 2025 r.3, r.6, r.8) apply eighteen months
  after 14 Nov 2025 (G.S.R. 843(E) para (c); Rules r.1(4)), i.e. from
  mid-May 2027.
  https://www.meity.gov.in/static/uploads/2025/11/c56ceae6c383460ca69577428d36828b.pdf
  https://www.meity.gov.in/static/uploads/2025/11/53450e6e5dc0bfa85ebd78686cadad39.pdf
"""
from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Callable, Mapping

NOTICE_VERSION = "2026-10-14"
TERMS_VERSION = "2026-10-14"

# What the user agrees to, in the notice's words (DPDP Rules r.3(b)(ii)).
CONSENT_PURPOSE = (
    "Keep my email, sign-in records and the plan I save, to run my RightDue account "
    "on any device (privacy notice " + NOTICE_VERSION + ")."
)


def _flag(name: str) -> Callable[[Mapping[str, str]], bool]:
    def on(env: Mapping[str, str]) -> bool:
        value = env.get(name, "").strip().lower()
        return bool(value) and value not in ("0", "false", "off", "no")
    return on


def _always(env: Mapping[str, str]) -> bool:
    return True


@dataclass(frozen=True)
class Processor:
    who: str
    role: str
    data: str
    active: Callable[[Mapping[str, str]], bool] = _always


# Every service that handles personal data for RightDue. Keep the names in
# step with PROCESSORS in web/src/lib/privacy-facts.ts.
PROCESSORS: tuple[Processor, ...] = (
    Processor("Neon", "database host (AWS Asia Pacific, Singapore)",
              "everything in this file: account, saved plan, sign-in records, consent records, access log, "
              "payday-email settings"),
    Processor("Render", "app server (Oregon, USA)",
              "requests while they are processed, including a credit report or KFS PDF you upload, "
              "which is read once and not stored"),
    Processor("Cloudflare", "network in front of rightdue.app (operates Render's edge)", "requests in transit"),
    Processor("Resend", "email delivery (USA)", "your email address and sign-in codes"),
    Processor("Google Fonts", "page font, loaded by your browser", "your IP address when the font loads"),
    Processor("Yahoo Finance", "share prices for the portfolio tool", "ticker symbols only, never who asked"),
    Processor("Resend (payday emails)", "email delivery (USA)",
              "the payday reminder you switched on: lender names and payment amounts",
              _flag("PAYDAY_EMAIL_ENABLED")),
    Processor("Sentry", "error reports (USA)",
              "error details with digits masked; none of your figures, email or address", _flag("SENTRY_DSN")),
    Processor("Cloudflare Turnstile", "check on the sign-in page that you are a person",
              "your IP address and browser signals, during the check", _flag("TURNSTILE_SECRET_KEY")),
    Processor("Google sign-in", "optional sign-in", "your email address, as Google verified it",
              _flag("GOOGLE_SIGNIN")),
)


def shared_with(env: Mapping[str, str] | None = None) -> list[dict[str, str]]:
    """The processors in use right now, for the s.11 export."""
    env = os.environ if env is None else env
    return [{"who": p.who, "role": p.role, "data": p.data} for p in PROCESSORS if p.active(env)]
