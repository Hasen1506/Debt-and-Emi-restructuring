import inspect
import ssl

import asyncpg
import pytest
from sqlalchemy.dialects.postgresql.asyncpg import PGDialect_asyncpg

from api.db.connection import connection_options


def test_external_postgres_options_reach_asyncpg_without_libpq_keywords():
    url, options = connection_options(
        "postgresql://example:example@db.example.neon.tech/rightdue?sslmode=require&channel_binding=prefer"
    )
    _, dialect_options = PGDialect_asyncpg().create_connect_args(url)
    combined = {**dialect_options, **options}
    assert set(combined) <= set(inspect.signature(asyncpg.connect).parameters)
    assert "sslmode" not in combined and "channel_binding" not in combined
    assert combined["ssl"].verify_mode == ssl.CERT_REQUIRED
    assert combined["ssl"].check_hostname is True


def test_internal_render_url_keeps_its_connection_behavior_and_credentials():
    url, options = connection_options("postgres://example:p%40ss@internal/rightdue")
    assert url.drivername == "postgresql+asyncpg"
    assert url.password == "p@ss"
    assert options == {}


def test_asyncpg_ssl_option_uses_system_trust_and_hostname_verification():
    _, options = connection_options("postgresql+asyncpg://db.example/rightdue?ssl=verify-full")
    assert options["ssl"].verify_mode == ssl.CERT_REQUIRED
    assert options["ssl"].check_hostname is True
    assert options["ssl"].cert_store_stats()["x509_ca"] > 0


@pytest.mark.parametrize("query", ["channel_binding=require", "sslmode=require&ssl=disable", "sslmode=unknown"])
def test_unsupported_or_conflicting_security_options_fail_without_exposing_credentials(query):
    with pytest.raises(ValueError) as error:
        connection_options(f"postgresql://example:private-password@db.example/rightdue?{query}")
    assert "private-password" not in str(error.value)
    assert "db.example" not in str(error.value)
