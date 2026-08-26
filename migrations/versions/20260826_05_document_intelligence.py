"""document intelligence dashboard metadata"""

import sqlalchemy as sa
from alembic import op

revision = "20260826_05"
down_revision = "20260820_04"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("documents", sa.Column("document_type", sa.String(length=96), nullable=True))
    op.add_column("documents", sa.Column("schema_version", sa.Integer(), server_default=sa.text("1"), nullable=False))
    op.add_column(
        "documents",
        sa.Column("extraction_status", sa.String(length=24), server_default=sa.text("'not_requested'"), nullable=False),
    )
    op.add_column(
        "documents",
        sa.Column("extracted_metadata", sa.JSON(), server_default=sa.text("'{}'::json"), nullable=False),
    )
    op.create_index("ix_documents_document_type", "documents", ["document_type"])
    op.create_index("ix_documents_extraction_status", "documents", ["extraction_status"])
    op.add_column("ingestion_jobs", sa.Column("document_type", sa.String(length=96), nullable=True))
    op.create_index("ix_ingestion_jobs_document_type", "ingestion_jobs", ["document_type"])


def downgrade() -> None:
    op.drop_index("ix_ingestion_jobs_document_type", table_name="ingestion_jobs")
    op.drop_column("ingestion_jobs", "document_type")
    op.drop_index("ix_documents_extraction_status", table_name="documents")
    op.drop_index("ix_documents_document_type", table_name="documents")
    op.drop_column("documents", "extracted_metadata")
    op.drop_column("documents", "extraction_status")
    op.drop_column("documents", "schema_version")
    op.drop_column("documents", "document_type")
