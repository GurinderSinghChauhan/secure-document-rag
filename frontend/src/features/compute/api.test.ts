import { vi } from "vitest";
import { api } from "../../api/client";
import type { IngestionJob } from "../../api/types";
import { listHeldJobs } from "./api";

function job(index: number): IngestionJob {
  return { job_id: `job-${index}` } as IngestionJob;
}

test("loads every held-job page beyond the first 500 records", async () => {
  const firstPage = Array.from({ length: 500 }, (_, index) => job(index));
  const secondPage = [job(500)];
  const request = vi
    .spyOn(api, "json")
    .mockResolvedValueOnce(firstPage)
    .mockResolvedValueOnce(secondPage);

  const result = await listHeldJobs();

  expect(result).toHaveLength(501);
  expect(request).toHaveBeenNthCalledWith(
    1,
    "/v1/admin/ingestion-jobs?state=held_for_compute&limit=500&offset=0",
    {},
    "Unable to load the indexing queue.",
  );
  expect(request).toHaveBeenNthCalledWith(
    2,
    "/v1/admin/ingestion-jobs?state=held_for_compute&limit=500&offset=500",
    {},
    "Unable to load the indexing queue.",
  );
});
