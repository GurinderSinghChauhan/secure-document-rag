"""automatic document classification state"""

import sqlalchemy as sa
from alembic import op

revision = "20260826_06"
down_revision = "20260826_05"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "documents",
        sa.Column(
            "classification_status",
            sa.String(length=24),
            server_default=sa.text("'unclassified'"),
            nullable=False,
        ),
    )
    op.add_column(
        "documents",
        sa.Column(
            "classification_source",
            sa.String(length=16),
            server_default=sa.text("'automatic'"),
            nullable=False,
        ),
    )
    op.add_column(
        "documents",
        sa.Column("classification_confidence", sa.Float(), nullable=True),
    )
    op.create_index(
        "ix_documents_classification_status",
        "documents",
        ["classification_status"],
    )
    op.execute(
        "UPDATE documents SET classification_status = 'confirmed', "
        "classification_source = 'manual' WHERE document_type IS NOT NULL"
    )


def downgrade() -> None:
    op.drop_index("ix_documents_classification_status", table_name="documents")
    op.drop_column("documents", "classification_confidence")
    op.drop_column("documents", "classification_source")
    op.drop_column("documents", "classification_status")
