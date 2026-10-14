"""Audit 80 E17/E19 (W9): what the API sends is exactly what its schema says.

The web app types every response by the API's schema (web/src/lib/api.ts and
the boundary parsers in web/src/lib/boundary.ts). A field the handler adds,
renames or reshapes without the schema knowing is the defect class behind
"a stale shape becomes a silent wrong number". Two generic guards:

1. Round trip: for generated profiles on every plan endpoint, the JSON body
   validates against the route's declared response model, and dumping that
   model gives back the same JSON (nothing dropped, renamed or re-typed,
   no Decimal string turned into a float).
2. Every JSON route declares a response model, except the ones listed in
   UNTYPED below, and that list may only shrink.
"""
from __future__ import annotations

import json

from fastapi.routing import APIRoute
from fastapi.testclient import TestClient
from hypothesis import given, settings
from hypothesis import strategies as st

from api.main import app
from api.tests.test_property_api import PLAN_ENDPOINTS, _body, user_payload
from engine.tests.strategies import examples

client = TestClient(app)


def _db_routers():
    """The sign-in and saved-state routers are only mounted when DATABASE_URL
    is set (api/main.py), so the guard imports them directly: a route must
    not escape the check just because the test run has no database."""
    from api.auth.account import router as account_router
    from api.auth.google import router as google_router
    from api.auth.routes import router as auth_router
    from api.routes import user_state
    return [auth_router, account_router, google_router, user_state.router]


def _walk(routes, prefix: str = ""):
    """Every API route with its full path. FastAPI 0.142 keeps included
    routers lazy (`_IncludedRouter`), so `app.routes` alone shows one route;
    their resolved contexts carry the real path, model and response class."""
    for r in routes:
        if isinstance(r, APIRoute):
            yield prefix + r.path, r
        elif hasattr(r, "effective_route_contexts"):
            for c in r.effective_route_contexts():
                yield c.path, c


def _all_routes():
    yield from _walk(app.routes)
    paths = {p for p, _ in _walk(app.routes)}
    for router in _db_routers():
        for p, r in _walk(router.routes, "/api"):
            if p not in paths:
                yield p, r


def _route(path: str, method: str = "POST"):
    for p, r in _walk(app.routes):
        if p == path and method in r.methods:
            return r
    raise AssertionError(f"no {method} {path}")


def _normal(x):
    """JSON with object keys sorted, so key order never fails a comparison."""
    return json.loads(json.dumps(x, sort_keys=True))


@settings(max_examples=examples(40))
@given(country=st.sampled_from(["IN", "US"]), data=st.data(), path=st.sampled_from(PLAN_ENDPOINTS))
def test_plan_responses_round_trip_through_their_schema(country, data, path):
    route = _route(path)
    assert route.response_model is not None, f"{path} declares no response model"
    res = client.post(path, json=_body(path, data.draw(user_payload(country))))
    if res.status_code != 200:
        return  # input bounds are guarded by test_api_fuzz / test_property_api
    body = res.json()
    model = route.response_model.model_validate(body)
    again = model.model_dump(mode="json", by_alias=True)
    assert _normal(again) == _normal(body), f"{path}: response changes when read through its own schema"


# Routes that return JSON without a response model (typed only by hand on the
# web side). Shrink-only: give a route a model, then delete its line here.
UNTYPED = {
    # Audit 80 baseline, 14 Oct 2026 (FastAPI 0.142.2, every router incl. DB-bound).
    "GET /api/rates/feed-health",      # ops/debug view of the rate feed; returns JSONResponse by hand
    "GET /api/auth/account/export",    # DPDP data export: a downloadable JSON file (Content-Disposition), not a typed body
    "GET /api/auth/google/start",      # 302 redirect to Google, no JSON body
    "GET /api/auth/google/callback",   # 302 redirect back to the app, no JSON body
}


def _json_routes_without_model() -> set[str]:
    out = set()
    for path, r in _all_routes():
        if not path.startswith("/api/") or not r.include_in_schema:
            continue
        if r.response_model is not None:
            continue
        cls = getattr(r.response_class, "value", r.response_class)  # DefaultPlaceholder -> JSONResponse
        if cls.__name__ not in ("JSONResponse", "ORJSONResponse"):
            continue  # HTML pages (notify ack/unsubscribe) are not JSON contracts
        if getattr(r, "status_code", None) == 204:
            continue  # no body at all
        for m in sorted(r.methods):
            out.add(f"{m} {path}")
    return out


def test_untyped_list_only_names_routes_that_exist_and_are_untyped():
    """Shrink-only: a route that gained a model (or was removed) must leave the list."""
    stale = UNTYPED - _json_routes_without_model()
    assert not stale, f"remove from UNTYPED (now typed or gone): {sorted(stale)}"


def test_route_walker_sees_the_whole_api():
    """If FastAPI changes how included routers are stored, the guard above
    would silently check nothing. Pin that it sees the plan routes."""
    paths = {p for p, _ in _all_routes()}
    for must in ("/api/simulate", "/api/baseline", "/api/user/state", "/api/auth/me"):
        assert must in paths, f"route walker lost {must}"
    assert len(paths) >= 40


def test_json_routes_declare_a_response_model():
    missing = _json_routes_without_model() - UNTYPED
    assert not missing, (
        "These JSON routes have no response model, so the web app can only cast their body: "
        f"{sorted(missing)}. Add response_model=... (or, if it really cannot have one, add it to UNTYPED with a reason)."
    )
