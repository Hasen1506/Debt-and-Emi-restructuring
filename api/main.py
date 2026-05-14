"""FastAPI gateway entrypoint. Run with: uvicorn api.main:app --reload"""
import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.routes import simulation, decisions, layer0, institutions, fx, credit_score

app = FastAPI(
    title="FinOptima Debt & EMI API",
    version="0.1.0",
    description="HTTP gateway exposing the debt-emi engine.",
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


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
