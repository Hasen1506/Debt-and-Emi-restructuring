"""FastAPI gateway entrypoint. Run with: uvicorn api.main:app --reload"""
import logging
import os
from contextlib import asynccontextmanager

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# Load .env before anything reads os.environ (engine, resend, etc).
load_dotenv()

from api import rates_feed  # noqa: E402
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
)

log = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    rates_feed.start()
    yield
    rates_feed.stop()


app = FastAPI(
    title="FinOptima Debt & EMI API",
    version="0.1.0",
    description="HTTP gateway exposing the debt-emi engine.",
    lifespan=lifespan,
)

# CORS_ORIGINS env var is comma-separated; falls back to localhost for dev.
_default_origins = "http://localhost:3000,http://127.0.0.1:3000"
_origins = [o.strip() for o in os.environ.get("CORS_ORIGINS", _default_origins).split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(simulation.router, prefix="/api")
app.include_router(decisions.router, prefix="/api")
app.include_router(layer0.router, prefix="/api")
app.include_router(institutions.router, prefix="/api")
app.include_router(fx.router, prefix="/api")
app.include_router(credit_score.router, prefix="/api")
app.include_router(restructuring.router, prefix="/api")
app.include_router(portfolio.router, prefix="/api")
app.include_router(rates.router, prefix="/api")
app.include_router(loan_check.router, prefix="/api")
app.include_router(complaints.router, prefix="/api")
app.include_router(offers.router, prefix="/api")

# DB-bound routers — only mounted when DATABASE_URL is configured.
# Skipping them on the Render free tier keeps the API up without a
# Postgres add-on while we're still in trial mode.
if db_enabled():
    from api.auth.routes import router as auth_router
    from api.routes import user_state

    app.include_router(auth_router, prefix="/api")
    app.include_router(user_state.router, prefix="/api")
else:
    log.warning("Skipping /api/auth/* and /api/user-state — DATABASE_URL unset.")


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok", "db": "enabled" if db_enabled() else "disabled"}
