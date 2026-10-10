"""The client's address, which a client cannot fake.

Behind a proxy the socket peer is the proxy, and the client address is
in X-Forwarded-For. Each proxy *appends* the address it saw, so only the
last TRUSTED_PROXY_HOPS entries were written by proxies we run behind;
anything to their left came from the client and can say anything. (Lost
bug: taking the first entry let one made-up header bypass the outcome
limits, and 36 fake reports gave a fake bank a 100% record.)

TRUSTED_PROXY_HOPS=0 (the default, for local runs) ignores the header
and uses the socket peer. In the single-service deploy (DEPLOY.md) the
API sits behind Cloudflare, Render and the Next.js server in the same
container; Next.js passes X-Forwarded-For through unchanged, so only
Cloudflare and Render count: TRUSTED_PROXY_HOPS=2.
"""
from __future__ import annotations

import os
from typing import Mapping, Optional


def proxy_hops() -> int:
    return int(os.environ.get("TRUSTED_PROXY_HOPS", "0"))


def client_ip(peer: Optional[str], forwarded_for: Optional[str], hops: int) -> str:
    peer = peer or "unknown"
    if hops <= 0 or not forwarded_for:
        return peer
    chain = [x.strip() for x in forwarded_for.split(",") if x.strip()]
    if not chain:
        return peer
    return chain[-hops] if len(chain) >= hops else chain[0]


def from_scope(scope: Mapping, hops: int) -> str:
    """For ASGI middleware."""
    peer = scope["client"][0] if scope.get("client") else None
    # Several X-Forwarded-For headers read as one list, in order.
    forwarded = ",".join(v.decode("latin-1") for k, v in scope.get("headers") or []
                         if k.lower() == b"x-forwarded-for")
    return client_ip(peer, forwarded, hops)


def from_request(request, hops: Optional[int] = None) -> str:
    """For routes (a Starlette Request)."""
    return from_scope(request.scope, proxy_hops() if hops is None else hops)
