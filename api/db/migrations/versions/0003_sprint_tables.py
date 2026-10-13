"""Tables added in the October 2026 sprint.

- otp_challenges, rate_buckets (sprint G8, grill #59): a sign-in code sent
  before any account exists, and the hourly rate-limit counters kept in
  Postgres. Both are models in api/db/models.py.
- rate_meeting_outcomes (sprint G9, grill #61): central-bank meeting outcomes
  an admin records (api/rate_outcomes_store.py).
- notify_subscriptions, notify_events (sprint G7): payday-email settings and
  answers (api/notify/store.py).

The last three are SQLAlchemy Core tables that their stores also create on
first use (`metadata.create_all`, which skips a table that exists), so this
revision creates them only when they are missing.

Revision ID: 0003_sprint_tables
Revises: 0002_user_state_version
Create Date: 2026-10-12
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0003_sprint_tables"
down_revision = "0002_user_state_version"
branch_labels = None
depends_on = None


def _missing(name: str) -> bool:
    return name not in sa.inspect(op.get_bind()).get_table_names()


def upgrade() -> None:
    if _missing("otp_challenges"):
        op.create_table(
            "otp_challenges",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
            sa.Column("email", sa.String(320), nullable=False),
            sa.Column("code_hash", sa.String(128), nullable=False),
            sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("used_at", sa.DateTime(timezone=True)),
            sa.Column("attempts", sa.Integer, nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        )
        op.create_index("ix_otp_challenges_email", "otp_challenges", ["email"])
        op.create_index("ix_otp_challenges_created_at", "otp_challenges", ["created_at"])
    if _missing("rate_buckets"):
        op.create_table(
            "rate_buckets",
            sa.Column("key", sa.String(160), primary_key=True),
            sa.Column("count", sa.Integer, nullable=False),
            sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        )
        op.create_index("ix_rate_buckets_expires_at", "rate_buckets", ["expires_at"])
    if _missing("rate_meeting_outcomes"):
        op.create_table(
            "rate_meeting_outcomes",
            sa.Column("country", sa.String(2), primary_key=True),
            sa.Column("meeting_date", sa.Date, primary_key=True),
            sa.Column("outcome_rate", sa.Numeric(7, 5), nullable=False),
            sa.Column("note", sa.String(500)),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        )
    if _missing("notify_subscriptions"):
        op.create_table(
            "notify_subscriptions",
            sa.Column("user_id", sa.String(64), primary_key=True),
            sa.Column("email", sa.String(320), nullable=False),
            sa.Column("payday_on", sa.Boolean, nullable=False),
            sa.Column("payday_day", sa.Integer),
            sa.Column("opted_in_on", sa.Date),
            sa.Column("snapshot", sa.Text),
            sa.Column("snapshot_at", sa.DateTime(timezone=True)),
            sa.Column("last_sent_month", sa.String(7)),
            sa.Column("reply_code", sa.String(16)),
            sa.Column("reminders_on", sa.Boolean, nullable=False),
            sa.Column("reminder_items", sa.Text),
            sa.Column("reminders_sent", sa.Text),
            sa.Column("updated_at", sa.DateTime(timezone=True)),
        )
    if _missing("notify_events"):
        op.create_table(
            "notify_events",
            sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
            sa.Column("user_id", sa.String(64), nullable=False),
            sa.Column("kind", sa.String(16), nullable=False),
            sa.Column("month", sa.String(7)),
            sa.Column("day", sa.Date, nullable=False),
            sa.Column("applied", sa.Boolean, nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        )
        op.create_index("ix_notify_events_user_id", "notify_events", ["user_id"])


def downgrade() -> None:
    for t in ("notify_events", "notify_subscriptions", "rate_meeting_outcomes", "rate_buckets", "otp_challenges"):
        op.execute(f"DROP TABLE IF EXISTS {t}")
