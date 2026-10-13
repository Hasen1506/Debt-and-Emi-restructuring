"""Live re-test 7 O-4: under three users, one /api/healthz and one signed-out
/api/session/auth/me each stalled ~15 s.

Both of those are answered by the Next.js server alone (healthz is a
force-static route handler; signed-out auth/me returns null before any
proxying), so FastAPI was not on their path. This test keeps the API side
honest anyway: the engine endpoints are plain ``def`` (FastAPI runs them in
its threadpool, so a long plan never blocks uvicorn's single event loop),
and /api/health is ``async`` with no dependencies (answered on the loop,
never queued behind the threadpool, never touching the database).
"""
import inspect

from fastapi.routing import APIRoute

from api import main
from api.routes import simulation

# Read from the router itself: newer FastAPI versions keep included routers
# as one entry in app.routes, so the app's flat list doesn't show them.
ENGINE_PATHS = {"/simulate", "/baseline", "/sensitivity/compare"}


def test_engine_endpoints_run_in_the_threadpool():
    routes = {r.path: r for r in simulation.router.routes if isinstance(r, APIRoute)}
    missing = ENGINE_PATHS - routes.keys()
    assert not missing, f"engine routes moved: {missing}"
    for path in ENGINE_PATHS:
        assert not inspect.iscoroutinefunction(routes[path].endpoint), (
            f"/api{path} is async: its synchronous engine work would block the event loop"
        )


def test_health_is_async_and_needs_nothing():
    assert inspect.iscoroutinefunction(main.health)
    assert list(inspect.signature(main.health).parameters) == []
