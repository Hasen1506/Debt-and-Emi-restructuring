"""FastAPI gateway entrypoint. Run with: uvicorn api.main:app --reload"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.routes import simulation, decisions, layer0, institutions

app = FastAPI(
    title="FinOptima Debt & EMI API",
    version="0.1.0",
    description="HTTP gateway exposing the debt-emi engine.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(simulation.router, prefix="/api")
app.include_router(decisions.router, prefix="/api")
app.include_router(layer0.router, prefix="/api")
app.include_router(institutions.router, prefix="/api")


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
