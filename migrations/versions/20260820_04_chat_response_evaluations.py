"""super admin chat response evaluations"""

import sqlalchemy as sa
from alembic import op

revision = "20260820_04"
down_revision = "20260819_03"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "chat_response_evaluations",
        sa.Column("evaluation_id", sa.String(length=36), nullable=False),
        sa.Column("response_message_id", sa.String(length=36), nullable=False),
        sa.Column("evaluator_user_id", sa.String(length=36), nullable=False),
        sa.Column("correctness", sa.Integer(), nullable=False),
        sa.Column("relevance", sa.Integer(), nullable=False),
        sa.Column("clarity", sa.Integer(), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("correctness BETWEEN 1 AND 5", name="ck_chat_evaluation_correctness"),
        sa.CheckConstraint("relevance BETWEEN 1 AND 5", name="ck_chat_evaluation_relevance"),
        sa.CheckConstraint("clarity BETWEEN 1 AND 5", name="ck_chat_evaluation_clarity"),
        sa.ForeignKeyConstraint(["evaluator_user_id"], ["users.user_id"]),
        sa.ForeignKeyConstraint(["response_message_id"], ["chat_messages.message_id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("evaluation_id"),
        sa.UniqueConstraint("response_message_id", name="uq_chat_response_evaluation_message"),
    )
    op.create_index("ix_chat_response_evaluations_response_message_id", "chat_response_evaluations", ["response_message_id"])
    op.create_index("ix_chat_response_evaluations_evaluator_user_id", "chat_response_evaluations", ["evaluator_user_id"])


def downgrade() -> None:
    op.drop_index("ix_chat_response_evaluations_evaluator_user_id", table_name="chat_response_evaluations")
    op.drop_index("ix_chat_response_evaluations_response_message_id", table_name="chat_response_evaluations")
    op.drop_table("chat_response_evaluations")
