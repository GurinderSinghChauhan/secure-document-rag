"""platform display settings"""

import sqlalchemy as sa
from alembic import op

revision = "20260902_07"
down_revision = "20260826_06"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "platform_settings",
        sa.Column("settings_id", sa.String(length=32), nullable=False),
        sa.Column(
            "show_classification_confidence",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
        ),
        sa.Column("updated_by", sa.String(length=36), nullable=True),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("settings_id"),
    )
    op.execute(
        "INSERT INTO platform_settings "
        "(settings_id, show_classification_confidence) VALUES ('global', false)"
    )


def downgrade() -> None:
    op.drop_table("platform_settings")
