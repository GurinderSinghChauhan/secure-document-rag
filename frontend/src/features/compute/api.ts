import { api } from "../../api/client";
import type { ComputeSession, IngestionJob } from "../../api/types";

export const computeKeys = {
  held: ["compute", "held-jobs"] as const,
  session: (id: string) => ["compute", "session", id] as const,
};
export const listHeldJobs = () =>
  api.json<IngestionJob[]>(
    "/v1/admin/ingestion-jobs?state=held_for_compute",
    {},
    "Unable to load held documents.",
  );
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
