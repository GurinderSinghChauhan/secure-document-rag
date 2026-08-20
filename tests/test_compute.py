import httpx
import pytest
from fastapi import HTTPException

from app.compute import RunpodProvider, assert_release_within_limits, estimated_cost
from app.config import Settings
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
