"""The client's address, which a client cannot fake.

Behind a proxy the socket peer is the proxy, and the client address is
in X-Forwarded-For. Each proxy *appends* the address it saw, so only the
last TRUSTED_PROXY_HOPS entries were written by proxies we run behind;
anything to their left came from the client and can say anything. (Lost
bug: taking the first entry let one made-up header bypass the outcome
limits, and 36 fake reports gave a fake bank a 100% record.)

UX50 E-01 (rate limits never fired in production). The real chain for
https://rightdue.app is NOT what render.yaml assumed. DNS goes straight to
Render (name.com NS, apex A 216.24.57.1); the founder's own Cloudflare zone
is not in the path. Render itself fronts every service with Cloudflare and
then its own load balancer, so X-Forwarded-For arrives as

    "<visitor>, <Cloudflare edge>, <Render load balancer 10.x>"

and the Next.js server in the container passes it on unchanged (its
rewrite proxy does not append; /api/session copies it). With
TRUSTED_PROXY_HOPS=2 the API read the *Cloudflare edge* address, which
changes from request to request, so every request got a fresh bucket and
no 429 was ever sent.

The fix: Render's Cloudflare edge always sets ``CF-Connecting-IP`` to the
address that connected to it, overwriting anything the client sent, so on
Render that one-address header is the client. It is read when
CLIENT_IP_HEADER names it. The default is ``cf-connecting-ip`` when the
``RENDER`` variable (set by Render on every service) is present and
nothing otherwise, so local runs and tests keep the socket peer / hop
logic. ``CLIENT_IP_HEADER=none`` turns it off. If the header is missing
or not an IP address, the X-Forwarded-For hop logic below is used, and
TRUSTED_PROXY_HOPS=3 is the right count for the chain above.

Only trust CLIENT_IP_HEADER where every request reaches the app through
the proxy that writes it (Render's edge does: *.onrender.com and custom
domains both pass Cloudflare). Elsewhere a client could send it.

IPv6 visitors get a whole /64 each (one home or phone line), because a
single device can pick any of 2^64 addresses in its prefix.
"""
from __future__ import annotations

import ipaddress
import logging
import os
from typing import Mapping, Optional

log = logging.getLogger("rightdue.client_ip")
_logged = False


def proxy_hops() -> int:
    return int(os.environ.get("TRUSTED_PROXY_HOPS", "0"))


def trusted_header(env: Optional[Mapping[str, str]] = None) -> Optional[str]:
    """The single-address client header to trust, lower case, or None."""
    env = os.environ if env is None else env
    raw = env.get("CLIENT_IP_HEADER")
    if raw is None:
        return "cf-connecting-ip" if env.get("RENDER") else None
    raw = raw.strip().lower()
    return None if raw in ("", "none", "off", "0", "false") else raw


def normalise(addr: str) -> Optional[str]:
    """A valid address as a bucket key (IPv6 as its /64), else None."""
    try:
        ip = ipaddress.ip_address(addr.strip().strip("[]"))
    except ValueError:
        return None
    if isinstance(ip, ipaddress.IPv6Address):
        if ip.ipv4_mapped:
            return str(ip.ipv4_mapped)
        return str(ipaddress.ip_network(f"{ip}/64", strict=False))
    return str(ip)


def client_ip(peer: Optional[str], forwarded_for: Optional[str], hops: int,
              header_value: Optional[str] = None) -> str:
    if header_value:
        # One address only; a comma means something other than the edge wrote it.
        if "," not in header_value:
            key = normalise(header_value)
            if key:
                return key
    peer = peer or "unknown"
    if hops <= 0 or not forwarded_for:
        return normalise(peer) or peer
    chain = [x.strip() for x in forwarded_for.split(",") if x.strip()]
    if not chain:
        return normalise(peer) or peer
    pick = chain[-hops] if len(chain) >= hops else chain[0]
    return normalise(pick) or pick


def _log_once(source: str, chain_len: int, has_header: bool) -> None:
    """E-01 (b): say once, without any address, which source the limits use."""
    global _logged
    if _logged:
        return
    _logged = True
    log.info("client_ip: rate-limit key from %s (x-forwarded-for entries=%d, trusted header present=%s)",
             source, chain_len, has_header)


def from_scope(scope: Mapping, hops: int, header: Optional[str] = ...) -> str:  # type: ignore[assignment]
    """For ASGI middleware."""
    if header is ...:
        header = trusted_header()
    peer = scope["client"][0] if scope.get("client") else None
    raw = scope.get("headers") or []
    # Several X-Forwarded-For headers read as one list, in order.
    forwarded = ",".join(v.decode("latin-1") for k, v in raw if k.lower() == b"x-forwarded-for")
    value = None
    if header:
        wanted = header.encode()
        values = [v.decode("latin-1") for k, v in raw if k.lower() == wanted]
        # Two copies of the header: not something the edge writes; ignore both.
        value = values[0] if len(values) == 1 else None
    result = client_ip(peer, forwarded, hops, value)
    if not _logged:
        used_header = bool(value) and "," not in value and normalise(value) is not None
        _log_once(header if used_header else (f"x-forwarded-for[-{hops}]" if hops > 0 and forwarded else "socket peer"),
                  len([x for x in forwarded.split(",") if x.strip()]), bool(value))
    return result


def from_request(request, hops: Optional[int] = None) -> str:
    """For routes (a Starlette Request)."""
    return from_scope(request.scope, proxy_hops() if hops is None else hops)
