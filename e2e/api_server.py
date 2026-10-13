"""Deterministic API for the golden E2E suite.

Starts the real FastAPI app (api.main:app) with every outside dependency
replaced by a fixed stub, so a browser run is reproducible to the cent:

* Email/OTP: no email is sent; every sign-in code is E2E_OTP (424242).
* FX: /api/fx-rate answers from FIXED_FX (1 USD = 83.25 INR), never the
  network. The cache is bypassed so every call sees the same number.
* Network: any outbound HTTP from the API (httpx, sync or async) to a host
  other than localhost raises, so a test can't pass by reaching the internet.
* Storage: E2E_DATABASE_URL must point at an empty Postgres database (the
  CI service container; production runs Neon Postgres). Its tables are
  dropped and recreated at start so every run begins signed-out and empty.
  SQLite is not used: it loses timezones and breaks session expiry.
  The rates feed and Polymarket odds are off; rate limits are off.

Run:  python e2e/api_server.py  [--port 8000]
"""
from __future__ import annotations

import argparse
import os
import sys
import tempfile
from decimal import Decimal
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

E2E_OTP = "424242"
FIXED_FX = {("USD", "INR"): Decimal("83.25"), ("INR", "USD"): Decimal("1") / Decimal("83.25")}
FX_AS_OF = "2026-10-01"


def configure_env(tmp: Path) -> None:
    url = os.environ.get("E2E_DATABASE_URL")
    if not url:
        sys.exit("Set E2E_DATABASE_URL to an empty Postgres database (see e2e/README.md).")
    os.environ["DATABASE_URL"] = url
    os.environ["OUTCOMES_DATABASE_URL"] = f"sqlite+aiosqlite:///{tmp / 'outcomes.sqlite3'}"
    os.environ["RATES_STORE_PATH"] = str(tmp / "rates.json")
    os.environ["RATES_FEED"] = "off"
    os.environ["RATE_LIMITS"] = "off"
    os.environ.setdefault("CORS_ORIGINS", "http://localhost:3100,http://127.0.0.1:3100")
    os.environ.pop("RESEND_API_KEY", None)


def block_network() -> None:
    import httpx

    def _guard(request: httpx.Request) -> None:
        host = request.url.host or ""
        if host not in ("localhost", "127.0.0.1", "::1", "testserver"):
            raise httpx.ConnectError(f"E2E: outbound network to {host} is blocked", request=request)

    orig_async, orig_sync = httpx.AsyncClient.send, httpx.Client.send

    async def asend(self, request, *a, **kw):
        _guard(request)
        return await orig_async(self, request, *a, **kw)

    def ssend(self, request, *a, **kw):
        _guard(request)
        return orig_sync(self, request, *a, **kw)

    httpx.AsyncClient.send = asend  # type: ignore[method-assign]
    httpx.Client.send = ssend  # type: ignore[method-assign]


def install_stubs() -> None:
    import api.auth.routes as auth_routes
    from api.routes import fx

    auth_routes.generate_otp = lambda: E2E_OTP
    auth_routes.send_otp_email = lambda to, code: None
    # The journeys sign the same persona in once per test, far more than the
    # per-email (5 / 10 min, 20 / day) and global (90 / day) code caps from
    # G8's OTP hardening allow. api/tests covers those caps; lift them here.
    auth_routes.OTP_MAX_REQUESTS = 10_000
    auth_routes.OTP_MAX_REQUESTS_DAILY = 10_000
    auth_routes.OTP_GLOBAL_DAILY_CAP = 10_000

    async def fixed_fetch(base: str, quote: str):
        if base == quote:
            return Decimal("1"), "parity", None
        rate = FIXED_FX.get((base, quote))
        if rate is None:
            return Decimal("1"), "fallback", None
        return rate, "frankfurter", FX_AS_OF

    fx._fetch_fx = fixed_fetch


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=int(os.environ.get("E2E_API_PORT", "8100")))
    args = ap.parse_args()
    tmp = Path(tempfile.mkdtemp(prefix="rightdue-e2e-"))
    configure_env(tmp)
    block_network()
    install_stubs()
    import asyncio

    import uvicorn
    from api.db import database, models  # noqa: F401  (registers tables)
    from api.main import app

    async def reset() -> None:
        async with database.engine.begin() as conn:
            await conn.run_sync(database.Base.metadata.drop_all)
            # Start-up migrates the schema (api/db/migrations): forget the
            # applied revision too, or it would find nothing left to run.
            from sqlalchemy import text
            await conn.execute(text("DROP TABLE IF EXISTS alembic_version"))
        await database.engine.dispose()

    asyncio.run(reset())

    uvicorn.run(app, host="127.0.0.1", port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
