"""UX50 E-01: rate limits must key on the visitor behind Render's real chain.

Render fronts every service with its own Cloudflare edge and then a load
balancer, so a request reaches the container with
    X-Forwarded-For: <visitor>, <Cloudflare edge (changes)>, <Render LB 10.x>
    CF-Connecting-IP: <visitor>         (written by the edge, never the client's)
and Next.js passes both on to FastAPI unchanged. The old TRUSTED_PROXY_HOPS=2
read the Cloudflare edge address, a new bucket on every request, so no 429
was ever sent in production.
"""
import itertools

from fastapi import FastAPI
from fastapi.testclient import TestClient

from api import client_ip
from api.security import DEFAULT_LIMITS, SecurityMiddleware

_edges = itertools.count(1)


def render_headers(visitor: str, *, forged_xff: str = "", forged_cf: str | None = None) -> dict:
    """What Render's edge + LB hand the container for one request."""
    edge = f"172.71.{next(_edges) % 250}.{next(_edges) % 250}"   # a different edge each time
    lb = f"10.226.{next(_edges) % 250}.65"
    xff = ", ".join(x for x in (forged_xff, visitor, edge, lb) if x)
    # Cloudflare overwrites a client-sent CF-Connecting-IP; forged_cf models a
    # client that tries anyway (the edge replaces it with the visitor).
    return {"x-forwarded-for": xff, "cf-connecting-ip": visitor,
            "x-forwarded-proto": "https", "true-client-ip": visitor}


def _app(env: dict, hops: int):
    app = FastAPI()

    @app.post("/api/auth/request-otp")
    async def otp(body: dict) -> dict:  # 422 on a bad body, like the real route
        return {}

    app.add_middleware(SecurityMiddleware, rate_limits=True, proxy_hops=hops,
                       ip_header=client_ip.trusted_header(env), persistent=None,
                       limits=DEFAULT_LIMITS)
    return TestClient(app)


def _codes(c: TestClient, n: int, visitor: str = "203.0.113.7", **kw) -> list[int]:
    return [c.post("/api/auth/request-otp", json={"email": "x"},
                   headers=render_headers(visitor, **kw)).status_code for _ in range(n)]


def test_old_config_reproduces_the_production_bug():
    # TRUSTED_PROXY_HOPS=2 and no trusted header: the key is the rotating edge.
    c = _app({}, hops=2)
    assert 429 not in _codes(c, 9)


def test_render_env_keys_on_cf_connecting_ip_and_limits_sign_in():
    # RENDER is set by Render on every service; TRUSTED_PROXY_HOPS still the old 2.
    c = _app({"RENDER": "true"}, hops=2)
    codes = _codes(c, 7)
    assert codes[:5] == [200] * 5
    assert codes[5] == 429 and codes[6] == 429     # burst 5 → 429 from the 6th


def test_forged_forwarded_for_does_not_make_a_new_bucket():
    c = _app({"RENDER": "true"}, hops=2)
    codes = [c.post("/api/auth/request-otp", json={},
                    headers=render_headers("198.51.100.9", forged_xff=f"1.2.3.{i}")).status_code
             for i in range(7)]
    assert 429 in codes


def test_other_visitors_are_not_blocked():
    c = _app({"RENDER": "true"}, hops=2)
    _codes(c, 7, visitor="198.51.100.20")
    assert _codes(c, 1, visitor="198.51.100.21") == [200]


def test_hop_count_three_also_matches_render_chain():
    c = _app({}, hops=3)
    assert 429 in _codes(c, 7)


def test_ipv6_visitors_share_their_slash_64():
    c = _app({"RENDER": "true"}, hops=2)
    codes = [c.post("/api/auth/request-otp", json={},
                    headers=render_headers(f"2001:db8:1:2::{i:x}")).status_code for i in range(1, 8)]
    assert 429 in codes


def test_trusted_header_defaults():
    assert client_ip.trusted_header({}) is None
    assert client_ip.trusted_header({"RENDER": "true"}) == "cf-connecting-ip"
    assert client_ip.trusted_header({"RENDER": "true", "CLIENT_IP_HEADER": "none"}) is None
    assert client_ip.trusted_header({"CLIENT_IP_HEADER": "True-Client-IP"}) == "true-client-ip"


def test_bad_or_listed_header_falls_back_to_hops():
    assert client_ip.client_ip("10.0.0.1", "203.0.113.5, 172.71.1.1, 10.2.2.2", 3, "not-an-ip") == "203.0.113.5"
    assert client_ip.client_ip("10.0.0.1", "203.0.113.5, 172.71.1.1, 10.2.2.2", 3, "1.1.1.1, 2.2.2.2") == "203.0.113.5"
    assert client_ip.client_ip("10.0.0.1", "", 0, "203.0.113.5") == "203.0.113.5"
    assert client_ip.client_ip(None, None, 0, "::ffff:203.0.113.5") == "203.0.113.5"


def test_two_copies_of_the_header_are_ignored():
    scope = {"client": ("10.0.0.1", 1), "headers": [
        (b"cf-connecting-ip", b"1.1.1.1"), (b"cf-connecting-ip", b"2.2.2.2"),
        (b"x-forwarded-for", b"203.0.113.5, 172.71.1.1, 10.2.2.2")]}
    assert client_ip.from_scope(scope, 3, "cf-connecting-ip") == "203.0.113.5"


def test_hsts_behind_render_even_with_zero_hops():
    c = _app({"RENDER": "true"}, hops=0)
    r = c.post("/api/auth/request-otp", json={}, headers=render_headers("203.0.113.40"))
    assert "strict-transport-security" in r.headers
