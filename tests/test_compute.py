from datetime import UTC, datetime

import httpx
import pytest
from fastapi import HTTPException

from app.compute import RunpodProvider, assert_release_within_limits, estimated_cost, recommended_gpu_minutes
from app.config import Settings
from app.database import IngestionJobRecord
from app.models import Principal
from app import main


def settings(**overrides) -> Settings:
    values = {
        "tenant_api_keys_json": '{"a-very-long-api-key-with-32-characters":{"tenant_id":"tenant","user_id":"admin","roles":["admin"]}}',
        **overrides,
    }
    return Settings(_env_file=None, **values)


def test_gpu_dispatch_is_disabled_and_credentials_optional_by_default():
    configured = settings()
    assert configured.gpu_dispatch_enabled is False
    assert configured.runpod_api_key is None
    assert configured.runpod_endpoint_id is None


@pytest.mark.asyncio
async def test_constructing_runpod_provider_performs_no_requests():
    requests = []

    async def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(500)

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    provider = RunpodProvider(settings(runpod_api_key="secret", runpod_endpoint_id="endpoint"), client)
    assert requests == []
    await provider.close()
    assert requests == []
    await client.aclose()


def test_release_limits_are_enforced_before_dispatch():
    with pytest.raises(ValueError, match="job limit"):
        assert_release_within_limits(released_job_count=2, requested_jobs=2, max_jobs=3, gpu_seconds=0, max_gpu_minutes=10, estimated_cost_usd=0, max_estimated_cost_usd=None)
    with pytest.raises(ValueError, match="GPU time"):
        assert_release_within_limits(released_job_count=0, requested_jobs=1, max_jobs=1, gpu_seconds=600, max_gpu_minutes=10, estimated_cost_usd=0, max_estimated_cost_usd=None)
    with pytest.raises(ValueError, match="cost"):
        assert_release_within_limits(released_job_count=0, requested_jobs=1, max_jobs=1, gpu_seconds=0, max_gpu_minutes=10, estimated_cost_usd=1, max_estimated_cost_usd=1)


def test_gpu_cost_uses_recorded_seconds():
    assert estimated_cost(1800, 0.5) == 0.25


def test_gpu_minute_recommendations_are_conservative_by_file_type_and_size():
    megabyte = 1024 * 1024

    assert recommended_gpu_minutes("text/plain", megabyte) == 1
    assert recommended_gpu_minutes("image/png", 4 * megabyte) == 3
    assert recommended_gpu_minutes("application/pdf", 10 * megabyte) == 10


def test_held_job_response_includes_inputs_for_automatic_guardrails():
    now = datetime.now(UTC)
    job = IngestionJobRecord(
        job_id="job", tenant_id="organization", state="held_for_compute", stage="held", progress=0,
        message="Waiting", document_name="report.pdf", content_type="application/pdf", content_sha256="a" * 64,
        content=b"document", size_bytes=1024 * 1024, allowed_roles=["admin"], allowed_users=[], created_by="user",
        compute_session_id=None, provider_job_id=None, attempt_count=0, retry_limit=3, result_document_id=None,
        chunks_indexed=0, tables_indexed=0, visuals_indexed=0, gpu_seconds=0, estimated_cost_usd=0,
        error_code=None, error_message=None, created_at=now, updated_at=now,
    )

    payload = main.job_response(job)

    assert payload.content_type == "application/pdf"
    assert payload.size_bytes == 1024 * 1024
    assert payload.recommended_gpu_minutes == 6


@pytest.mark.asyncio
async def test_active_compute_session_restores_the_tenant_open_session(monkeypatch):
    principal = Principal(tenant_id="organization", user_id="admin", roles=["admin"])
    compute_session = object()
    payload = object()

    async def get_open(session, tenant_id):
        assert tenant_id == "organization"
        return compute_session

    async def serialize(session, record):
        assert record is compute_session
        return payload

    monkeypatch.setattr(main, "get_open_compute_session", get_open)
    monkeypatch.setattr(main, "compute_session_payload", serialize)

    assert await main.get_active_compute_session(principal, object()) is payload


@pytest.mark.asyncio
async def test_held_job_inventory_supports_stable_pages_beyond_500():
    class Session:
        statement = None

        async def scalars(self, statement):
            self.statement = statement
            return []

    session = Session()
    principal = Principal(tenant_id="organization", user_id="admin", roles=["admin"])

    result = await main.list_ingestion_jobs(
        state="held_for_compute",
        limit=500,
        offset=500,
        principal=principal,
        session=session,
    )
    sql = str(session.statement.compile(compile_kwargs={"literal_binds": True}))

    assert result == []
    assert "ingestion_jobs.created_at DESC, ingestion_jobs.job_id DESC" in sql
    assert "LIMIT 500 OFFSET 500" in sql


@pytest.mark.asyncio
async def test_failed_ingestion_job_can_be_reset_for_an_explicit_retry(monkeypatch):
    now = datetime.now(UTC)
    job = IngestionJobRecord(
        job_id="job", tenant_id="organization", state="failed", stage="failed", progress=96,
        message="Retry limit exhausted.", document_name="report.pdf", content_type="application/pdf",
        content_sha256="a" * 64, content=b"document", size_bytes=1024, allowed_roles=["admin"],
        allowed_users=[], created_by="user", compute_session_id="old-session", provider_job_id="provider-job",
        attempt_count=3, retry_limit=3, result_document_id=None, chunks_indexed=0, tables_indexed=0,
        visuals_indexed=0, gpu_seconds=1, estimated_cost_usd=0, error_code="processing_failed",
        error_message="metadata failed", created_at=now, updated_at=now,
    )

    class Session:
        async def scalar(self, statement):
            return job

        async def commit(self):
            return None

        async def refresh(self, record):
            return None

    async def no_audit(*args, **kwargs):
        return None

    monkeypatch.setattr(main, "record", no_audit)
    principal = Principal(
        tenant_id="organization",
        user_id="admin",
        roles=["admin"],
        is_super_admin=True,
    )

    result = await main.retry_ingestion_job("job", principal, Session())

    assert result.state == "held_for_compute"
    assert result.stage == "held"
    assert result.progress == 0
    assert job.attempt_count == 0
    assert job.compute_session_id is None
    assert job.provider_job_id is None
    assert job.error_code is None
    assert job.error_message is None


def test_chat_compute_is_available_without_a_document_session(monkeypatch):
    monkeypatch.setattr(main, "get_settings", lambda: settings(gpu_dispatch_enabled=True, compute_provider="local_docker"))

    assert main.require_compute_for_query() is None


def test_chat_compute_fails_closed_when_dispatch_is_disabled(monkeypatch):
    monkeypatch.setattr(main, "get_settings", lambda: settings(gpu_dispatch_enabled=False))

    with pytest.raises(HTTPException, match="enable dispatch"):
        main.require_compute_for_query()


def test_chat_compute_rejects_asynchronous_provider(monkeypatch):
    monkeypatch.setattr(main, "get_settings", lambda: settings(gpu_dispatch_enabled=True, compute_provider="runpod"))

    with pytest.raises(HTTPException, match="asynchronous compute provider"):
        main.require_compute_for_query()
