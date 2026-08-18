from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, Protocol

import httpx
from pydantic import BaseModel, Field

from .config import Settings


class WorkerJobInput(BaseModel):
    contract_version: Literal["1"] = "1"
    job_id: str
    tenant_ref: str
    operation: Literal["ingest", "query"]
    input_url: str
    output_url: str
    content_sha256: str
    model_profile: str
    processing_profile: str
    deadline_epoch_seconds: int
    cancellation_token: str


class WorkerJobResult(BaseModel):
    contract_version: Literal["1"] = "1"
    artifact_url: str | None = None
    artifact_sha256: str | None = None
    duration_seconds: float = Field(ge=0)
    gpu_seconds: float = Field(ge=0)
    status: Literal["completed", "failed", "cancelled", "out_of_memory"]
    error_code: str | None = None
    error_message: str | None = None


@dataclass(frozen=True)
class ProviderJob:
    provider_job_id: str
    status: str


class ComputeProvider(Protocol):
    name: str

    async def submit(self, payload: WorkerJobInput) -> ProviderJob: ...

    async def status(self, provider_job_id: str) -> dict[str, object]: ...

    async def result(self, provider_job_id: str) -> dict[str, object]: ...

    async def cancel(self, provider_job_id: str) -> None: ...

    async def health(self) -> dict[str, object]: ...

    async def usage(self, provider_job_id: str) -> dict[str, object]: ...

    async def close(self) -> None: ...


class LocalDockerProvider:
    """Marker adapter for the same portable worker contract in development.

    The control plane executes local work itself after an explicit admin release;
    constructing this adapter never launches a container or contacts a service.
    """

    name = "local_docker"

    async def submit(self, payload: WorkerJobInput) -> ProviderJob:
        raise RuntimeError("Local jobs are submitted through the control-plane dispatcher")

    async def status(self, provider_job_id: str) -> dict[str, object]:
        return {"id": provider_job_id, "status": "UNKNOWN"}

    async def result(self, provider_job_id: str) -> dict[str, object]:
        return await self.status(provider_job_id)

    async def cancel(self, provider_job_id: str) -> None:
        return None

    async def health(self) -> dict[str, object]:
        return {"status": "idle", "active_workers": 0}

    async def usage(self, provider_job_id: str) -> dict[str, object]:
        return {"id": provider_job_id, "gpu_seconds": 0}

    async def close(self) -> None:
        return None


class RunpodProvider:
    name = "runpod"

    def __init__(self, settings: Settings, client: httpx.AsyncClient | None = None):
        self._settings = settings
        self._client = client or httpx.AsyncClient(timeout=30)
        self._owns_client = client is None

    def _endpoint(self) -> tuple[str, dict[str, str]]:
        if not self._settings.runpod_api_key or not self._settings.runpod_endpoint_id:
            raise RuntimeError("Runpod credentials and endpoint are required before releasing Runpod work")
        base = self._settings.runpod_api_base_url.rstrip("/")
        return f"{base}/{self._settings.runpod_endpoint_id}", {"Authorization": f"Bearer {self._settings.runpod_api_key}"}

    async def submit(self, payload: WorkerJobInput) -> ProviderJob:
        endpoint, headers = self._endpoint()
        response = await self._client.post(f"{endpoint}/run", headers=headers, json={"input": payload.model_dump(mode="json")})
        response.raise_for_status()
        body = response.json()
        return ProviderJob(provider_job_id=str(body["id"]), status=str(body.get("status", "IN_QUEUE")))

    async def status(self, provider_job_id: str) -> dict[str, object]:
        endpoint, headers = self._endpoint()
        response = await self._client.get(f"{endpoint}/status/{provider_job_id}", headers=headers)
        response.raise_for_status()
        return response.json()

    async def result(self, provider_job_id: str) -> dict[str, object]:
        return await self.status(provider_job_id)

    async def cancel(self, provider_job_id: str) -> None:
        endpoint, headers = self._endpoint()
        response = await self._client.post(f"{endpoint}/cancel/{provider_job_id}", headers=headers)
        response.raise_for_status()

    async def health(self) -> dict[str, object]:
        endpoint, headers = self._endpoint()
        response = await self._client.get(f"{endpoint}/health", headers=headers)
        response.raise_for_status()
        return response.json()

    async def usage(self, provider_job_id: str) -> dict[str, object]:
        payload = await self.status(provider_job_id)
        execution_ms = float(payload.get("executionTime", 0) or 0)
        return {"id": provider_job_id, "gpu_seconds": execution_ms / 1000, "provider_status": payload.get("status")}

    async def close(self) -> None:
        if self._owns_client:
            await self._client.aclose()


def estimated_cost(gpu_seconds: float, hourly_rate_usd: float) -> float:
    return round((gpu_seconds / 3600) * hourly_rate_usd, 6)


def assert_release_within_limits(
    *,
    released_job_count: int,
    requested_jobs: int,
    max_jobs: int,
    gpu_seconds: float,
    max_gpu_minutes: float,
    estimated_cost_usd: float,
    max_estimated_cost_usd: float | None,
) -> None:
    if released_job_count + requested_jobs > max_jobs:
        raise ValueError("Release exceeds the session job limit")
    if gpu_seconds >= max_gpu_minutes * 60:
        raise ValueError("The session GPU time limit has been reached")
    if max_estimated_cost_usd is not None and estimated_cost_usd >= max_estimated_cost_usd:
        raise ValueError("The session estimated cost limit has been reached")
