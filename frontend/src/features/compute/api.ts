import { api } from "../../api/client";
import type { ComputeSession, IngestionJob } from "../../api/types";

export const computeKeys = {
  held: ["compute", "held-jobs"] as const,
  session: (id: string) => ["compute", "session", id] as const,
};
export async function listHeldJobs() {
  const pageSize = 500;
  const jobs: IngestionJob[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const page = await api.json<IngestionJob[]>(
      `/v1/admin/ingestion-jobs?state=held_for_compute&limit=${pageSize}&offset=${offset}`,
      {},
      "Unable to load held documents.",
    );
    jobs.push(...page);
    if (page.length < pageSize) return jobs;
  }
}
export const getComputeSession = (id: string) =>
  api.json<ComputeSession>(`/v1/admin/compute-sessions/${id}`);
export async function releaseJobs(jobIds: string[], maxGpuMinutes: number) {
  const session = await api.json<ComputeSession>(
    "/v1/admin/compute-sessions",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        max_jobs: jobIds.length,
        max_gpu_minutes: maxGpuMinutes,
      }),
    },
    "Unable to open compute session.",
  );
  return api.json<ComputeSession>(
    `/v1/admin/compute-sessions/${session.session_id}/release`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ job_ids: jobIds }),
    },
    "Unable to release jobs.",
  );
}
