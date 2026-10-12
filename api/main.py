"""FastAPI gateway entrypoint. Run with: uvicorn api.main:app --reload"""
import logging
import os
from contextlib import asynccontextmanager

from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from engine.surplus import MissingFxRate
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

# Load .env before anything reads os.environ (engine, resend, etc).
load_dotenv()

from api import observability, outcomes_store, rates_feed  # noqa: E402
from api.security import SecurityMiddleware  # noqa: E402
from api.db.database import db_enabled, init_db  # noqa: E402
from api.routes import (  # noqa: E402
    simulation,
    decisions,
    layer0,
    institutions,
    fx,
    credit_score,
    restructuring,
    portfolio,
    rates,
    complaints,
    offers,
    loan_check,
    outcomes,
    kfs,
    credit_report,
    closure,
)
from api.notify import routes as notify_routes  # noqa: E402

log = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    if db_enabled():
        from api.auth import retention
        await retention.purge_on_startup()  # sign-in record retention (grill #51)
    await outcomes_store.store().init()
    rates_feed.start()
    yield
    rates_feed.stop()
    await outcomes_store.store().close()


app = FastAPI(
    title="RightDue Debt & EMI API",
    version="0.1.0",
    description="HTTP gateway exposing the debt-emi engine.",
    lifespan=lifespan,
)

# CORS_ORIGINS env var is comma-separated; falls back to localhost for dev.
_default_origins = "http://localhost:3000,http://127.0.0.1:3000"
_origins = [o.strip() for o in os.environ.get("CORS_ORIGINS", _default_origins).split(",") if o.strip()]

# Size cap, security headers, rate limits. Added before CORS so CORS wraps
# it and a 413 or 429 still reaches the browser readable.
app.add_middleware(SecurityMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)



@app.exception_handler(RequestValidationError)
async def _validation_error(request: Request, exc: RequestValidationError) -> JSONResponse:
    """Every 422 in one shape: {"detail": {"field", "message"}}.

    The routes' own checks already answer like this (api/routes/loan_check.py
    `bad`); schema errors now match, so the web client can show any of
    them next to the field. The input is not echoed back.
    """
    errors = []
    for e in exc.errors():
        if e.get("type") == "json_invalid":
            errors.append({"field": "", "message": "The request is not valid JSON."})
            continue
        field = ".".join(str(x) for x in e.get("loc", ()) if x != "body")
        msg = str(e.get("msg", "Invalid value")).removeprefix("Value error, ")
        errors.append({"field": field, "message": f"{field}: {msg}" if field else msg})
    first = errors[0] if errors else {"field": "", "message": "The request could not be read."}
    return JSONResponse(status_code=422, content={"detail": first, "errors": errors[:20]})


@app.exception_handler(Exception)
async def _unhandled(request: Request, exc: Exception) -> JSONResponse:
    """A bug: report it to Sentry when SENTRY_DSN is set (api/observability,
    grill #64; no body, query, headers or account are sent), and answer
    with a plain 500 that doesn't echo anything back."""
    route = getattr(request.scope.get("route"), "path", "") or request.url.path
    observability.capture_exception(exc, request.method, route)
    return JSONResponse(status_code=500, content={"detail": {"field": "", "message": "Something went wrong on our side."}})


@app.exception_handler(MissingFxRate)
async def _missing_fx(request: Request, exc: MissingFxRate) -> JSONResponse:
    """A foreign loan reached the engine without an exchange rate (H4).
    The schema normally catches this first; never guess parity."""
    msg = f"{exc} — save an exchange rate for each foreign loan."
    return JSONResponse(status_code=422, content={"detail": {"field": "user.fx_to_user_currency", "message": msg}})


app.include_router(simulation.router, prefix="/api")
from api.routes import payoff_range  # noqa: E402  (sprint G4, grill #24)
app.include_router(payoff_range.router, prefix="/api")
app.include_router(decisions.router, prefix="/api")
app.include_router(layer0.router, prefix="/api")
app.include_router(institutions.router, prefix="/api")
app.include_router(fx.router, prefix="/api")
app.include_router(credit_score.router, prefix="/api")
app.include_router(restructuring.router, prefix="/api")
app.include_router(portfolio.router, prefix="/api")
app.include_router(rates.router, prefix="/api")
app.include_router(loan_check.router, prefix="/api")
app.include_router(kfs.router, prefix="/api")
app.include_router(credit_report.router, prefix="/api")
app.include_router(complaints.router, prefix="/api")
app.include_router(offers.router, prefix="/api")
app.include_router(outcomes.router, prefix="/api")
# G7: loan-cleared letter (no sign-in) and notifications (each route 404s
# while its flag is off; the signed-in ones need DATABASE_URL).
app.include_router(closure.router, prefix="/api")
app.include_router(notify_routes.router, prefix="/api")

# DB-bound routers — only mounted when DATABASE_URL is configured.
# Skipping them on the Render free tier keeps the API up without a
# Postgres add-on while we're still in trial mode.
if db_enabled():
    from api.auth.account import router as account_router
    from api.auth.routes import router as auth_router
    from api.auth.google import router as google_router
    from api.routes import user_state

    app.include_router(auth_router, prefix="/api")
    app.include_router(account_router, prefix="/api")
    # Sign in with Google: every route 404s unless GOOGLE_SIGNIN=1 and the
    # client id/secret are set (api/auth/google.py, DEPLOY.md).
    app.include_router(google_router, prefix="/api")
    app.include_router(user_state.router, prefix="/api")
else:
    log.warning("Skipping /api/auth/* and /api/user-state — DATABASE_URL unset.")


@app.get("/api/health")
def health() -> dict[str, str]:
    kind = outcomes_store.store().kind
    return {
        "status": "ok",
        "db": "enabled" if db_enabled() else "disabled",
        # "sqlite" on Render's free plan loses shared reports on every deploy.
        "outcomes_storage": "database" if kind == "postgresql" else "local file",
    }
