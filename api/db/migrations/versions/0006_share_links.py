"""Read-only family share links.

One row per link. The public page reads `snapshot`, which is built without
email, account numbers, UPI ids or PAN. Revoking the row hides the page.

Revision ID: 0006_share_links
Revises: 0005_retention
Create Date: 2026-10-19
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0006_share_links"
down_revision = "0005_retention"
branch_labels = None
depends_on = None


def _missing(name: str) -> bool:
    return name not in sa.inspect(op.get_bind()).get_table_names()


def upgrade() -> None:
    if _missing("share_links"):
        op.create_table(
            "share_links",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
            sa.Column("token", sa.String(64), nullable=False),
            sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("revoked", sa.Boolean, nullable=False, server_default=sa.false()),
            sa.Column("hide_loans", sa.Boolean, nullable=False, server_default=sa.false()),
            sa.Column("snapshot", postgresql.JSONB, nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        )
        op.create_index("ix_share_links_token", "share_links", ["token"], unique=True)
        op.create_index("ix_share_links_user_id", "share_links", ["user_id"])


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS share_links")
