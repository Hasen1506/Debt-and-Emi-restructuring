"""PostgreSQL URL options adapted to SQLAlchemy's asyncpg driver."""
from __future__ import annotations

import ssl

from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine


def connection_options(raw_url: str):
    url = make_url(raw_url)
    if url.drivername in ("postgres", "postgresql"):
        url = url.set(drivername="postgresql+asyncpg")
    options = {}
    if url.drivername == "postgresql+asyncpg":
        query = dict(url.query)
        # asyncpg has no channel-binding option. Do not silently promise a
        # required authentication mechanism that this driver cannot supply.
        binding = query.pop("channel_binding", None)
        if binding not in (None, "prefer", "disable"):
            raise ValueError(
                "asyncpg does not support required channel binding. Use an "
                "asyncpg-compatible connection URL without channel_binding "
                "and with certificate-verified TLS."
            )
        mode = query.pop("sslmode", None)
        ssl_option = query.pop("ssl", None)
        if mode is not None and ssl_option is not None:
            raise ValueError("Specify either sslmode or ssl, not both.")
        mode = mode if mode is not None else ssl_option
        root = query.pop("sslrootcert", None)
        if mode is None and root is not None:
            mode = "verify-full"
        if mode in ("require", "verify-ca", "verify-full"):
            # Use the system roots, rather than asyncpg's ~/.postgresql file
            # default. Hosted databases also need hostname verification.
            options["ssl"] = ssl.create_default_context(cafile=root)
        elif mode in ("disable", "allow", "prefer"):
            if root is not None:
                raise ValueError("sslrootcert requires certificate-verified TLS.")
            options["ssl"] = False if mode == "disable" else mode
        elif mode is not None:
            raise ValueError("Unsupported PostgreSQL SSL mode.")
        url = url.set(query=query)
    return url, options


def database_engine(raw_url: str) -> AsyncEngine:
    url, options = connection_options(raw_url)
    return create_async_engine(url, connect_args=options, pool_pre_ping=True)
