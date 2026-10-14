"""Retention + measurement tables (audit80 workstream W5: A13, A12, A15/A18).

- notify_rate_watch (A13): repo-linked loans a user asked to be emailed about
  after an RBI repo move (loan name, outstanding, rate, EMI, months left; no
  account numbers) and the last decision emailed about (api/notify/store.py).
- notify_run_lock (A12): one /api/notify/run at a time, so GitHub Actions and
  cron-job.org never both send (the second caller gets 409).
- funnel_counts (A15/A18): counts-only funnel, one aggregate counter per
  day/event/step/field/loan kind/country. No user id, no IP (api/funnel.py).

Like 0003, these are SQLAlchemy Core tables that their stores also create on
first use (`metadata.create_all` skips a table that exists), so this revision
creates each only when it is missing, and is expand-only (new tables only):
the previous release runs on this schema.

INTEGRATOR NOTE: W8 adds 0004_trust_records (Revises: 0003_sprint_tables) on
branch hark/a80-w08-*. This branch does not have it, so down_revision here is
0003_sprint_tables to keep this branch's alembic chain valid. When both are
merged, set down_revision = "0004_trust_records" and make
api/tests/test_state_versions_and_migrations.py expect head '0005_retention'.

Revision ID: 0005_retention
Revises: 0003_sprint_tables (re-chain to 0004_trust_records on integration)
Create Date: 2026-10-14
"""
from alembic import op
import sqlalchemy as sa

revision = "0005_retention"
down_revision = "0003_sprint_tables"
branch_labels = None
depends_on = None


def _missing(name: str) -> bool:
    return name not in sa.inspect(op.get_bind()).get_table_names()


def upgrade() -> None:
    if _missing("notify_rate_watch"):
        op.create_table(
            "notify_rate_watch",
            sa.Column("user_id", sa.String(64), primary_key=True),
            sa.Column("email", sa.String(320), nullable=False),
            sa.Column("watch_on", sa.Boolean, nullable=False),
            sa.Column("loans", sa.Text),
            sa.Column("saved_at", sa.DateTime(timezone=True)),
            sa.Column("last_decision", sa.String(10)),
            sa.Column("opted_in_on", sa.Date),
        )
    if _missing("notify_run_lock"):
        op.create_table(
            "notify_run_lock",
            sa.Column("name", sa.String(32), primary_key=True),
            sa.Column("locked_until", sa.DateTime(timezone=True), nullable=False),
        )
    if _missing("funnel_counts"):
        op.create_table(
            "funnel_counts",
            sa.Column("day", sa.Date, nullable=False),
            sa.Column("event", sa.String(32), nullable=False),
            sa.Column("step", sa.Integer, nullable=False),
            sa.Column("field", sa.String(40), nullable=False),
            sa.Column("loan_kind", sa.String(20), nullable=False),
            sa.Column("country", sa.String(2), nullable=False),
            sa.Column("n", sa.Integer, nullable=False),
            sa.PrimaryKeyConstraint("day", "event", "step", "field", "loan_kind", "country",
                                    name="pk_funnel_counts"),
        )


def downgrade() -> None:
    for t in ("funnel_counts", "notify_run_lock", "notify_rate_watch"):
        op.execute(f"DROP TABLE IF EXISTS {t}")
