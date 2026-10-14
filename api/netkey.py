"""Which "network" a request comes from, for rate limits (audit80 D13).

An IPv6 user (or a script) controls a whole /64: every device on a mobile or
home connection gets one, and can pick any of its 2^64 addresses. Counting
limits per exact IPv6 address is therefore no limit at all, so IPv6 is
grouped by its /64.

IPv4 is kept per address (/32), deliberately NOT grouped by /24 as the audit
first suggested: Indian mobile carriers put many unrelated subscribers behind
carrier-grade NAT, and a /24 would make strangers share one budget. The
per-address limits plus Turnstile (api/auth/turnstile.py) are the defence
for IPv4; NETKEY_V4_PREFIX can widen it (e.g. 24) if abuse shows up.

Only a keyed hash of the network is ever stored (HMAC-SHA256 with
RATE_BUCKET_KEY, else OUTCOMES_IP_KEY, as api/rate_buckets.py does).
"""
from __future__ import annotations

import hashlib
import hmac
import ipaddress
import os


def _prefix(name: str, default: int, top: int) -> int:
    try:
        value = int(os.environ.get(name, default))
    except ValueError:
        return default
    return min(max(value, 8), top)


def network_of(ip: str) -> str:
    """The network an address belongs to, as CIDR text. Anything that is
    not an IP address (e.g. "unknown") is returned unchanged."""
    try:
        addr = ipaddress.ip_address(ip.strip())
    except ValueError:
        return ip
    if isinstance(addr, ipaddress.IPv6Address) and addr.ipv4_mapped is not None:
        addr = addr.ipv4_mapped
    if isinstance(addr, ipaddress.IPv4Address):
        bits = _prefix("NETKEY_V4_PREFIX", 32, 32)
    else:
        bits = _prefix("NETKEY_V6_PREFIX", 64, 128)
    return str(ipaddress.ip_network(f"{addr}/{bits}", strict=False))


def _key() -> bytes:
    key = os.environ.get("RATE_BUCKET_KEY") or os.environ.get("OUTCOMES_IP_KEY") or "rightdue-rate-buckets-unkeyed"
    return key.encode()


def network_key(ip: str, key: bytes | None = None) -> str:
    """A 32-character keyed hash of the requester's network."""
    return hmac.new(key if key is not None else _key(), network_of(ip).encode(), hashlib.sha256).hexdigest()[:32]
