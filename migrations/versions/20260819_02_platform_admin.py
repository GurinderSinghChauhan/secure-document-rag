"""platform super administrators and organization suspension"""

import sqlalchemy as sa
from alembic import op

revision = "20260819_02"
down_revision = "20260818_01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("organizations", sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()))
    op.create_index("ix_organizations_active", "organizations", ["active"])
    op.add_column("users", sa.Column("is_super_admin", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.create_index("ix_users_is_super_admin", "users", ["is_super_admin"])


def downgrade() -> None:
    op.drop_index("ix_users_is_super_admin", table_name="users")
    op.drop_column("users", "is_super_admin")
    op.drop_index("ix_organizations_active", table_name="organizations")
    op.drop_column("organizations", "active")
