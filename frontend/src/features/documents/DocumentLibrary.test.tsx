import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { server } from "../../test/server";
import { DocumentLibrary } from "./DocumentLibrary";

test("confirms and deletes every organization document in one request", async () => {
  let deleted = false;
  let deleteRequests = 0;
  server.use(
    http.get("/v1/document-schemas", () => HttpResponse.json([])),
    http.get("/v1/admin/documents", () =>
      HttpResponse.json(
        deleted
          ? []
          : [
              {
                document_id: "document-1",
                document_name: "policy.pdf",
                document_type: null,
                schema_version: 2,
                classification_status: "unclassified",
                classification_source: "automatic",
                classification_confidence: null,
                extraction_status: "not_requested",
                extracted_metadata: {},
                content_type: "application/pdf",
                size_bytes: 1024,
                chunk_count: 4,
                allowed_roles: ["admin"],
                allowed_users: [],
                created_by: "admin-1",
                created_at: "2030-01-01T00:00:00Z",
              },
            ],
      ),
    ),
    http.delete("/v1/admin/documents", () => {
      deleted = true;
      deleteRequests += 1;
      return HttpResponse.json({ deleted_count: 1, status: "deleted" });
    }),
  );
  vi.spyOn(window, "confirm").mockReturnValue(true);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <DocumentLibrary />
    </QueryClientProvider>,
  );

  expect(await screen.findByText("policy.pdf")).toBeVisible();
  await userEvent.click(
    screen.getByRole("button", { name: "Delete all documents" }),
  );

  expect(window.confirm).toHaveBeenCalledWith(
    expect.stringContaining("Delete all indexed documents"),
  );
  await waitFor(() => expect(deleteRequests).toBe(1));
  expect(
    await screen.findByText("No indexed documents in this organization."),
  ).toBeVisible();
});

test("manually classifies an unclassified document and starts the remaining pipeline", async () => {
  const onComputeStarted = vi.fn();
  let requestedType: string | null = null;
  server.use(
    http.get("/v1/document-schemas", () =>
      HttpResponse.json([
        {
          key: "accounts_payable",
          label: "Accounts Payable",
          description: "Invoices and payments",
          document_types: [
            {
              key: "accounts_payable.invoice",
              label: "Invoice",
              fields: ["invoice_number"],
            },
          ],
        },
      ]),
    ),
    http.get("/v1/admin/documents", () =>
      HttpResponse.json([
        {
          document_id: "document-1",
          document_name: "invoice.pdf",
          document_type: null,
          schema_version: 2,
          classification_status: "unclassified",
          classification_source: "automatic",
          classification_confidence: null,
          extraction_status: "not_requested",
          extracted_metadata: {},
          content_type: "application/pdf",
          size_bytes: 1024,
          chunk_count: 4,
          allowed_roles: ["admin"],
          allowed_users: [],
          created_by: "admin-1",
          created_at: "2030-01-01T00:00:00Z",
        },
      ]),
    ),
    http.post(
      "/v1/admin/documents/document-1/classification",
      async ({ request }) => {
        requestedType = (
          (await request.json()) as { document_type: string | null }
        ).document_type;
        return HttpResponse.json(
          {
            job_id: "job-1",
            state: "held_for_compute",
            message: "Document saved and waiting.",
            recommended_gpu_minutes: 6,
          },
          { status: 202 },
        );
      },
    ),
    http.post("/v1/admin/compute-sessions", () =>
      HttpResponse.json({ session_id: "session-1" }, { status: 201 }),
    ),
    http.post("/v1/admin/compute-sessions/session-1/release", () =>
      HttpResponse.json({ session_id: "session-1" }),
    ),
  );
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <DocumentLibrary onComputeStarted={onComputeStarted} />
    </QueryClientProvider>,
  );

  expect(await screen.findByText("invoice.pdf")).toBeVisible();
  await userEvent.selectOptions(
    screen.getByLabelText("Classification for invoice.pdf"),
    "accounts_payable.invoice",
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Classify & complete indexing" }),
  );

  await waitFor(() => {
    expect(requestedType).toBe("accounts_payable.invoice");
    expect(onComputeStarted).toHaveBeenCalledWith("session-1");
  });
});
