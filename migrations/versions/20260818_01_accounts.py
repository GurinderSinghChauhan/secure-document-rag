"""organization accounts and JWT sessions"""
from alembic import op
from app.database import Base

revision = "20260818_01"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    Base.metadata.create_all(bind=bind)
    bind.exec_driver_sql(
        """
        INSERT INTO organizations (organization_id, name, slug)
        SELECT tenant_id, tenant_id, regexp_replace(lower(tenant_id), '[^a-z0-9]+', '-', 'g')
        FROM (
            SELECT tenant_id FROM documents
            UNION SELECT tenant_id FROM chat_sessions
            UNION SELECT tenant_id FROM ingestion_jobs
            UNION SELECT tenant_id FROM compute_sessions
        ) existing
        WHERE tenant_id IS NOT NULL
        ON CONFLICT DO NOTHING
        """
    )


def downgrade() -> None:
    raise RuntimeError("Authentication migration is intentionally irreversible")
