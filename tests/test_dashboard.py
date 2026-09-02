from datetime import UTC, datetime

import pytest
from fastapi import HTTPException
from sqlalchemy.dialects import postgresql

from app.database import DocumentRecord
from app.document_schemas import (
    DOCUMENT_SCHEMAS,
    INDUSTRIES,
    SCHEMA_VERSION,
    require_document_schema,
)
from app.main import (
    classification_decision,
    dashboard,
    dashboard_documents,
    validate_document_type,
)
from app.models import Principal


class DashboardSession:
    def __init__(self, documents):
        self.documents = documents
        self.statement = None

    async def scalars(self, statement):
        self.statement = statement
        return self.documents


class DashboardSearchSession(DashboardSession):
    async def scalar(self, statement):
        self.count_statement = statement
        return 1


def document(
    document_id: str,
    *,
    document_type: str | None,
    roles: list[str],
    users: list[str],
    extraction_status: str = "not_requested",
    classification_status: str | None = None,
    classification_source: str = "automatic",
    classification_confidence: float | None = None,
) -> DocumentRecord:
    return DocumentRecord(
        document_id=document_id,
        tenant_id="org-a",
        document_name=f"{document_id}.pdf",
        document_type=document_type,
        schema_version=1,
        classification_status=classification_status
        or ("confirmed" if document_type else "unclassified"),
        classification_source=classification_source,
        classification_confidence=classification_confidence,
        extraction_status=extraction_status,
        extracted_metadata={"invoice_number": "INV-1"} if extraction_status == "completed" else {},
        content_type="application/pdf",
        content_sha256=document_id.ljust(64, "a"),
        size_bytes=1024,
        chunk_count=4,
        allowed_roles=roles,
        allowed_users=users,
        created_by="admin-a",
        created_at=datetime.now(UTC),
    )


def test_document_schema_registry_is_versioned_unique_and_complete():
    keys = [document.key for industry in INDUSTRIES for document in industry.document_types]

    assert SCHEMA_VERSION == 2
    assert len(INDUSTRIES) == 11
    assert len(keys) == 74
    assert {
        industry.key: len(industry.document_types) for industry in INDUSTRIES
    } == {
        "field_service": 7,
        "contract_intelligence": 6,
        "litigation": 7,
        "healthcare": 7,
        "insurance": 7,
        "accounts_payable": 7,
        "construction": 7,
        "manufacturing": 7,
        "banking_lending": 7,
        "hr": 6,
        "property_management": 6,
    }
    assert len(keys) == len(set(keys)) == len(DOCUMENT_SCHEMAS)
    assert all(document.fields for industry in INDUSTRIES for document in industry.document_types)
    assert require_document_schema("accounts_payable.invoice").label == "Invoice"
    assert require_document_schema("construction.change_order").label == "Change Order"
    assert require_document_schema("manufacturing.sop").label == "SOP"
    assert require_document_schema("banking_lending.loan_application").label == "Loan Application"
    assert require_document_schema("hr.performance_review").label == "Performance Review"
    assert require_document_schema("property_management.lease_agreement").label == "Lease Agreement"
    with pytest.raises(ValueError, match="Unsupported document type"):
        require_document_schema("unknown.type")


def test_document_type_validation_returns_422_for_unknown_values():
    with pytest.raises(HTTPException, match="Unsupported document type") as error:
        validate_document_type("unknown.type")
    assert error.value.status_code == 422


@pytest.mark.parametrize(
    ("confidence", "expected_type", "expected_status"),
    [
        (0.85, "accounts_payable.invoice", "confirmed"),
        (0.60, "accounts_payable.invoice", "review_required"),
        (0.59, None, "unclassified"),
    ],
)
def test_classification_confidence_thresholds(
    confidence,
    expected_type,
    expected_status,
):
    assert classification_decision(
        "accounts_payable.invoice",
        confidence,
        0.85,
        0.60,
    ) == (expected_type, expected_status)


@pytest.mark.asyncio
async def test_dashboard_only_aggregates_documents_authorized_for_current_user():
    principal = Principal(tenant_id="org-a", user_id="member-a", roles=["member"])
    session = DashboardSession(
        [
            document(
                "visible-role",
                document_type="accounts_payable.invoice",
                roles=["member"],
                users=[],
                extraction_status="completed",
                classification_status="review_required",
                classification_confidence=0.72,
            ),
            document(
                "secret-admin",
                document_type="contract_intelligence.msa",
                roles=["admin"],
                users=[],
            ),
            document(
                "visible-user",
                document_type=None,
                roles=["admin"],
                users=["member-a"],
            ),
        ]
    )

    result = await dashboard(principal, session)

    assert result.total_documents == 2
    assert result.classified_documents == 1
    assert result.extracted_documents == 1
    assert result.review_required_documents == 1
    accounts_payable = next(item for item in result.industries if item.key == "accounts_payable")
    assert accounts_payable.document_count == 1
    assert {item.document_name for item in result.recent_documents} == {
        "visible-role.pdf",
        "visible-user.pdf",
    }
    sql = str(session.statement.compile(dialect=postgresql.dialect()))
    assert "documents.tenant_id" in sql
    assert "documents.deleted_at IS NULL" in sql
    assert "CAST(documents.allowed_roles AS JSONB) @>" in sql
    assert "CAST(documents.allowed_users AS JSONB) @>" in sql


@pytest.mark.asyncio
async def test_dashboard_document_search_is_acl_scoped_and_server_filtered():
    principal = Principal(tenant_id="org-a", user_id="member-a", roles=["member"])
    session = DashboardSearchSession(
        [
            document(
                "matching-invoice",
                document_type="accounts_payable.invoice",
                roles=["member"],
                users=[],
            ),
            document(
                "secret-invoice",
                document_type="accounts_payable.invoice",
                roles=["admin"],
                users=[],
            ),
        ]
    )

    result = await dashboard_documents(
        principal,
        session,
        query="Invoice",
        limit=100,
        offset=100,
    )

    assert result.total == 1
    assert [item.document_name for item in result.documents] == [
        "matching-invoice.pdf"
    ]
    sql = str(session.statement.compile(dialect=postgresql.dialect()))
    assert "documents.document_name ILIKE" in sql
    assert "documents.document_type IN" in sql
    assert "CAST(documents.allowed_roles AS JSONB) @>" in sql
    assert "documents.created_at DESC, documents.document_id DESC" in sql
    assert "LIMIT" in sql and "OFFSET" in sql
    parameters = session.statement.compile(dialect=postgresql.dialect()).params
    assert list(parameters.values()).count(100) == 2
