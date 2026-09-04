import { api } from "../../api/client";
import type { ComputeSession, IngestionJob } from "../../api/types";

export const computeKeys = {
  queue: ["compute", "queue"] as const,
  active: ["compute", "active-session"] as const,
  session: (id: string) => ["compute", "session", id] as const,
};
async function listJobsByState(state: "held_for_compute" | "failed") {
  const pageSize = 500;
  const jobs: IngestionJob[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const page = await api.json<IngestionJob[]>(
      `/v1/admin/ingestion-jobs?state=${state}&limit=${pageSize}&offset=${offset}`,
      {},
      "Unable to load the indexing queue.",
    );
    jobs.push(...page);
    if (page.length < pageSize) return jobs;
  }
}
export const listHeldJobs = () => listJobsByState("held_for_compute");
export async function listQueueJobs() {
  const jobs = (
    await Promise.all([
      listJobsByState("held_for_compute"),
      listJobsByState("failed"),
    ])
  ).flat();
  return jobs.sort((left, right) =>
    right.created_at.localeCompare(left.created_at),
  );
}
export const getComputeSession = (id: string) =>
  api.json<ComputeSession>(`/v1/admin/compute-sessions/${id}`);
export const getActiveComputeSession = () =>
  api.json<ComputeSession | null>("/v1/admin/compute-sessions/active");
export const retryIngestionJob = (jobId: string) =>
  api.json<IngestionJob>(
    `/v1/admin/ingestion-jobs/${jobId}/retry`,
    { method: "POST" },
    "Unable to retry document indexing.",
  );
export async function releaseJobs(jobIds: string[]) {
  return api.json<ComputeSession>(
    "/v1/admin/compute-sessions/release",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ job_ids: jobIds }),
    },
    "Unable to add documents to compute.",
  );
}
