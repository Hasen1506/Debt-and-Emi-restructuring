"""Trust records (audit80 Section D).

- consent_events (D2, D7, D12): which notice and terms versions were agreed
  to, when, by which channel, with the 18+ declaration; and withdrawals.
- auth_log_tombstones (D6): sign-in records of a deleted account, kept for
  the retention period (founder decision, rank 12), then purged.
- access_log (D8): one line per read/write of a saved plan, export, delete.
- sessions.device_label, sessions.last_seen_at (D21): a coarse device name
  ("Firefox on Windows") for the account page's device list.
- otp_challenges.network_key, otp_challenges.for_account (D13): a keyed hash
  of the requesting network and whether the address already had an account,
  so the daily new-sign-up budget is per network and never blocks existing
  accounts.

Expand-only: new tables and nullable/defaulted columns, so the previous
release runs on this schema (docs/RUNBOOK.md §1, rolling back a schema change).

Revision ID: 0004_trust_records
Revises: 0003_sprint_tables
Create Date: 2026-10-14
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0004_trust_records"
down_revision = "0003_sprint_tables"
branch_labels = None
depends_on = None


def _columns(table: str) -> set[str]:
    return {c["name"] for c in sa.inspect(op.get_bind()).get_columns(table)}


def upgrade() -> None:
    op.create_table(
        "consent_events",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True)),
        sa.Column("email", sa.String(320), nullable=False),
        sa.Column("action", sa.String(16), nullable=False),
        sa.Column("notice_version", sa.String(32), nullable=False),
        sa.Column("terms_version", sa.String(32), nullable=False),
        sa.Column("purpose", sa.String(200), nullable=False),
        sa.Column("age_confirmed", sa.Boolean, nullable=False),
        sa.Column("channel", sa.String(16), nullable=False),
        sa.Column("at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_consent_events_user_id", "consent_events", ["user_id"])
    op.create_index("ix_consent_events_email", "consent_events", ["email"])
    op.create_index("ix_consent_events_at", "consent_events", ["at"])

    op.create_table(
        "auth_log_tombstones",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("email", sa.String(320), nullable=False),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True)),
        sa.Column("used_at", sa.DateTime(timezone=True)),
        sa.Column("ended_at", sa.DateTime(timezone=True)),
        sa.Column("wrong_guesses", sa.Integer, nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_auth_log_tombstones_email", "auth_log_tombstones", ["email"])
    op.create_index("ix_auth_log_tombstones_deleted_at", "auth_log_tombstones", ["deleted_at"])

    op.create_table(
        "access_log",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True)),
        sa.Column("action", sa.String(16), nullable=False),
        sa.Column("route", sa.String(120), nullable=False),
        sa.Column("outcome", sa.String(16), nullable=False),
        sa.Column("at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_access_log_user_id", "access_log", ["user_id"])
    op.create_index("ix_access_log_at", "access_log", ["at"])

    have = _columns("sessions")
    if "device_label" not in have:
        op.add_column("sessions", sa.Column("device_label", sa.String(80)))
    if "last_seen_at" not in have:
        op.add_column("sessions", sa.Column("last_seen_at", sa.DateTime(timezone=True)))

    have = _columns("otp_challenges")
    if "network_key" not in have:
        op.add_column("otp_challenges", sa.Column("network_key", sa.String(40), nullable=False, server_default=""))
        op.create_index("ix_otp_challenges_network_key", "otp_challenges", ["network_key"])
    if "for_account" not in have:
        op.add_column("otp_challenges", sa.Column("for_account", sa.Boolean, nullable=False, server_default=sa.false()))


def downgrade() -> None:
    op.drop_index("ix_otp_challenges_network_key", table_name="otp_challenges")
    op.drop_column("otp_challenges", "for_account")
    op.drop_column("otp_challenges", "network_key")
    op.drop_column("sessions", "last_seen_at")
    op.drop_column("sessions", "device_label")
    op.drop_table("access_log")
    op.drop_table("auth_log_tombstones")
    op.drop_table("consent_events")
