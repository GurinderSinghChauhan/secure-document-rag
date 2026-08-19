"""seven day organization trials"""

import sqlalchemy as sa
from alembic import op

revision = "20260819_03"
down_revision = "20260819_02"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("organizations", sa.Column("trial_started_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("organizations", sa.Column("trial_ends_at", sa.DateTime(timezone=True), nullable=True))
    op.execute("UPDATE organizations SET trial_started_at = created_at, trial_ends_at = created_at + INTERVAL '7 days'")
    op.alter_column("organizations", "trial_started_at", nullable=False, server_default=sa.func.now())
    op.alter_column("organizations", "trial_ends_at", nullable=False)
    op.create_index("ix_organizations_trial_ends_at", "organizations", ["trial_ends_at"])


def downgrade() -> None:
    op.drop_index("ix_organizations_trial_ends_at", table_name="organizations")
    op.drop_column("organizations", "trial_ends_at")
    op.drop_column("organizations", "trial_started_at")
