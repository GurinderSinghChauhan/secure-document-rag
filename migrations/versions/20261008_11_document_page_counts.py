"""Persist verified PDF page counts without guessing historical pagination."""

import sqlalchemy as sa
from alembic import op

revision = "20261008_11"
down_revision = "20260904_10"
branch_labels = None
depends_on = None


def upgrade() -> None:
    for table in ("documents", "ingestion_jobs"):
        op.add_column(table, sa.Column("page_count", sa.Integer(), nullable=True))
        op.create_check_constraint(f"ck_{table}_page_count", table, "page_count IS NULL OR page_count > 0")


def downgrade() -> None:
    for table in ("ingestion_jobs", "documents"):
        op.drop_constraint(f"ck_{table}_page_count", table, type_="check")
        op.drop_column(table, "page_count")
