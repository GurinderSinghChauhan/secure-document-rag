import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { server } from "../../test/server";
import { ComputeQueue } from "./ComputeQueue";

const job = {
  job_id: "job-1",
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
    http.get("/v1/admin/ingestion-jobs", () => HttpResponse.json([job])),
    http.post("/v1/admin/compute-sessions", () =>
      HttpResponse.json(session, { status: 201 }),
    ),
    http.post("/v1/admin/compute-sessions/session-1/release", () =>
      HttpResponse.json(session),
    ),
    http.get("/v1/admin/compute-sessions/session-1", () =>
      HttpResponse.json(session),
    ),
  );
  const user = userEvent.setup();
  renderQueue();

  expect(await screen.findByText(/1 document safely held/)).toBeVisible();
  await user.click(screen.getByLabelText("Select all waiting"));
  await user.click(
    screen.getByRole("button", { name: "Start selected batch" }),
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
