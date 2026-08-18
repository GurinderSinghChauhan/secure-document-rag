import httpx
import pytest

from app.compute import RunpodProvider, assert_release_within_limits, estimated_cost
from app.config import Settings


def settings(**overrides) -> Settings:
    values = {
        "tenant_api_keys_json": '{"a-very-long-api-key-with-32-characters":{"tenant_id":"tenant","user_id":"admin","roles":["admin"]}}',
        **overrides,
    }
    return Settings(**values)


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
