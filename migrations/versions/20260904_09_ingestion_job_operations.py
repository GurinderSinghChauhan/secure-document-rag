"""distinguish indexing from metadata extraction jobs"""

import sqlalchemy as sa
from alembic import op

revision = "20260904_09"
down_revision = "20260902_08"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "ingestion_jobs",
        sa.Column(
            "operation",
            sa.String(length=32),
            server_default=sa.text("'index'"),
            nullable=False,
        ),
    )
    op.create_index(
        "ix_ingestion_jobs_operation",
        "ingestion_jobs",
        ["operation"],
    )


def downgrade() -> None:
    op.drop_index("ix_ingestion_jobs_operation", table_name="ingestion_jobs")
    op.drop_column("ingestion_jobs", "operation")
