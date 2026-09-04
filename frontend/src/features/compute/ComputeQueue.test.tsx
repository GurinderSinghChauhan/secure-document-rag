import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { server } from "../../test/server";
import { ComputeQueue } from "./ComputeQueue";

const job = {
  job_id: "job-1",
  operation: "index" as const,
  document_name: "discharge_summary_07.pdf",
  document_type: null,
  content_type: "application/pdf",
  size_bytes: 2048,
  recommended_gpu_minutes: 6,
  state: "held_for_compute",
  stage: "held",
  progress: 0,
  message: "GPU processing is off; document saved and waiting.",
  compute_session_id: null,
  result_document_id: null,
  chunks_indexed: 0,
  tables_indexed: 0,
  visuals_indexed: 0,
  error_code: null,
  error_message: null,
  created_at: "2030-01-01T00:00:00Z",
  updated_at: "2030-01-01T00:00:00Z",
};

const session = {
  session_id: "session-1",
  status: "open",
  provider: "local",
  max_jobs: 1,
  max_gpu_minutes: 6,
  max_estimated_cost_usd: null,
  released_job_count: 1,
  gpu_seconds: 0,
  estimated_cost_usd: 0,
  jobs: [
    {
      ...job,
      state: "processing",
      stage: "extracting",
      progress: 13,
      message: "MinerU is extracting document content",
      compute_session_id: "session-1",
    },
  ],
};

function renderQueue() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ComputeQueue disabled={false} />
    </QueryClientProvider>,
  );
}

test("shows compute as the single authoritative processing stage", async () => {
  server.use(
    http.get("/v1/admin/compute-sessions/active", () =>
      HttpResponse.json(null),
    ),
    http.get("/v1/admin/ingestion-jobs", ({ request }) =>
      HttpResponse.json(
        new URL(request.url).searchParams.get("state") === "held_for_compute"
          ? [job]
          : [],
      ),
    ),
    http.post("/v1/admin/compute-sessions/release", () =>
      HttpResponse.json(session),
    ),
    http.get("/v1/admin/compute-sessions/session-1", () =>
      HttpResponse.json(session),
    ),
  );
  const user = userEvent.setup();
  renderQueue();

  expect(await screen.findByText(/1 document needs attention/)).toBeVisible();
  await user.click(
    screen.getByRole("button", { name: "Start queued work (1)" }),
  );

  expect(await screen.findByText("Extracting content")).toBeVisible();
  expect(
    screen.getByText("MinerU is extracting document content"),
  ).toBeVisible();
  expect(screen.getByText("13%")).toBeVisible();
  expect(screen.getByText("Auto-updating")).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "Refresh" }),
  ).not.toBeInTheDocument();
});

test("restores an active indexing session after a page reload", async () => {
  const restoredSession = {
    ...session,
    jobs: [
      {
        ...job,
        job_id: "job-complete",
        document_name: "finished.pdf",
        state: "completed",
        stage: "completed",
        progress: 100,
      },
      ...session.jobs,
    ],
  };
  server.use(
    http.get("/v1/admin/compute-sessions/active", () =>
      HttpResponse.json(restoredSession),
    ),
    http.get("/v1/admin/compute-sessions/session-1", () =>
      HttpResponse.json(restoredSession),
    ),
  );

  renderQueue();

  expect(await screen.findByText("Extracting content")).toBeVisible();
  expect(
    screen.getByText("MinerU is extracting document content"),
  ).toBeVisible();
  expect(screen.getByText("13%")).toBeVisible();
  expect(screen.queryByText("finished.pdf")).not.toBeInTheDocument();
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});

test("retries every failed document in one GPU session", async () => {
  const failedJob = {
    ...job,
    state: "failed",
    stage: "failed",
    message: "Retry limit exhausted.",
    error_code: "processing_failed",
    error_message: "Metadata extraction failed",
  };
  const failedJob2 = {
    ...failedJob,
    job_id: "job-2",
    document_name: "invoice.pdf",
    created_at: "2030-01-02T00:00:00Z",
  };
  const retryRequest = vi.fn();
  const releaseRequest = vi.fn();
  server.use(
    http.get("/v1/admin/compute-sessions/active", () =>
      HttpResponse.json(null),
    ),
    http.get("/v1/admin/ingestion-jobs", ({ request }) =>
      HttpResponse.json(
        new URL(request.url).searchParams.get("state") === "failed"
          ? [failedJob, failedJob2]
          : [],
      ),
    ),
    http.post("/v1/admin/ingestion-jobs/:jobId/retry", ({ params }) => {
      retryRequest(params.jobId);
      return HttpResponse.json({ ...job, job_id: params.jobId });
    }),
    http.post("/v1/admin/compute-sessions/release", async ({ request }) => {
      releaseRequest(await request.json());
      return HttpResponse.json(session);
    }),
    http.get("/v1/admin/compute-sessions/session-1", () =>
      HttpResponse.json(session),
    ),
  );
  const user = userEvent.setup();

  renderQueue();

  expect(await screen.findAllByText("Indexing failed")).toHaveLength(2);
  expect(screen.getAllByText("Metadata extraction failed")).toHaveLength(2);
  await user.click(
    screen.getByRole("button", { name: "Retry failed work (2)" }),
  );
  expect(await screen.findByText("Extracting content")).toBeVisible();
  expect(retryRequest).toHaveBeenCalledTimes(2);
  expect(releaseRequest).toHaveBeenCalledOnce();
  expect(releaseRequest).toHaveBeenCalledWith({
    job_ids: ["job-2", "job-1"],
  });
});

test("shows a clear queue when no documents need attention", async () => {
  server.use(
    http.get("/v1/admin/compute-sessions/active", () =>
      HttpResponse.json(null),
    ),
    http.get("/v1/admin/ingestion-jobs", () => HttpResponse.json([])),
  );

  renderQueue();

  expect(
    await screen.findByText(
      "No documents are waiting. New uploads start processing automatically.",
    ),
  ).toBeVisible();
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});
