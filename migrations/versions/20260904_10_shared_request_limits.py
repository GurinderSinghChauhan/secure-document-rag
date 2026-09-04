"""add shared request rate limits"""

import sqlalchemy as sa
from alembic import op

revision = "20260904_10"
down_revision = "20260904_09"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "request_limits",
        sa.Column("limit_key", sa.String(length=255), nullable=False),
        sa.Column("window_started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("request_count", sa.Integer(), nullable=False),
        sa.PrimaryKeyConstraint("limit_key"),
    )
    op.create_index(
        "ix_request_limits_window_started_at",
        "request_limits",
        ["window_started_at"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_request_limits_window_started_at",
        table_name="request_limits",
    )
    op.drop_table("request_limits")
