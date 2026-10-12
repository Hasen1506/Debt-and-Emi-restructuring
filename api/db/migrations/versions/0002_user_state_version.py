"""user_state.version and slice_versions: refuse stale writes (critique #63).

`version` counts writes to the row. `slice_versions` records, per top-level
slice of the blob, the version at which that slice last changed, so two
devices editing different slices still merge, and a device writing a slice
someone else changed after it last read is refused (HTTP 412).

Revision ID: 0002_user_state_version
Revises: 0001_baseline
Create Date: 2026-10-12
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0002_user_state_version"
down_revision = "0001_baseline"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("user_state", sa.Column("version", sa.Integer, nullable=False, server_default="0"))
    op.add_column(
        "user_state",
        sa.Column("slice_versions", postgresql.JSONB, nullable=False, server_default="{}"),
    )


def downgrade() -> None:
    op.drop_column("user_state", "slice_versions")
    op.drop_column("user_state", "version")
