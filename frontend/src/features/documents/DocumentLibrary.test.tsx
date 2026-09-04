import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { server } from "../../test/server";
import { DocumentLibrary } from "./DocumentLibrary";

test("selects multiple visible documents and deletes them together", async () => {
  const deletedIds: string[] = [];
  const makeDocument = (documentId: string, documentName: string) => ({
    document_id: documentId,
    document_name: documentName,
    document_type: "legal.policy",
    schema_version: 2,
    classification_status: "classified",
    classification_source: "automatic",
    classification_confidence: 0.94,
    extraction_status: "completed",
    extracted_metadata: {},
    content_type: "application/pdf",
    size_bytes: 1024,
    chunk_count: 4,
    allowed_roles: ["admin"],
    allowed_users: [],
    created_by: "admin-1",
    created_at: "2030-01-01T00:00:00Z",
  });
  server.use(
    http.get("/v1/document-schemas", () => HttpResponse.json([])),
    http.get("/v1/admin/documents", () =>
      HttpResponse.json(
        [
          makeDocument("document-1", "policy.pdf"),
          makeDocument("document-2", "contract.pdf"),
          makeDocument("document-3", "invoice.pdf"),
        ].filter((document) => !deletedIds.includes(document.document_id)),
      ),
    ),
    http.delete("/v1/documents/:documentId", ({ params }) => {
      deletedIds.push(String(params.documentId));
      return HttpResponse.json({
        document_id: params.documentId,
        status: "deleted",
      });
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
  await userEvent.click(screen.getByLabelText("Select policy.pdf"));
  await userEvent.click(screen.getByLabelText("Select contract.pdf"));
  expect(screen.getByText("2 selected")).toBeVisible();

  await userEvent.click(
    screen.getByRole("button", { name: "Delete selected" }),
  );

  expect(window.confirm).toHaveBeenCalledWith(
    expect.stringContaining("Delete 2 selected documents"),
  );
  await waitFor(() =>
    expect(deletedIds.sort()).toEqual(["document-1", "document-2"]),
  );
  expect(await screen.findByText("invoice.pdf")).toBeVisible();
  await waitFor(() => expect(screen.queryByText("policy.pdf")).toBeNull());
  expect(screen.getByText("0 selected")).toBeVisible();
});

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

test("extracts data for selected document types in one compute session", async () => {
  const onComputeStarted = vi.fn();
  const requestedTypes: Record<string, string | null> = {};
  let releasedJobIds: string[] = [];
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
        {
          document_id: "document-2",
          document_name: "credit-note.pdf",
          document_type: null,
          schema_version: 2,
          classification_status: "failed",
          classification_source: "automatic",
          classification_confidence: null,
          extraction_status: "failed",
          extracted_metadata: {},
          content_type: "application/pdf",
          size_bytes: 2048,
          chunk_count: 2,
          allowed_roles: ["admin"],
          allowed_users: [],
          created_by: "admin-1",
          created_at: "2030-01-02T00:00:00Z",
        },
        {
          document_id: "document-3",
          document_name: "classified-policy.pdf",
          document_type: "legal.policy",
          schema_version: 2,
          classification_status: "confirmed",
          classification_source: "automatic",
          classification_confidence: 0.95,
          extraction_status: "completed",
          extracted_metadata: {},
          content_type: "application/pdf",
          size_bytes: 1024,
          chunk_count: 3,
          allowed_roles: ["admin"],
          allowed_users: [],
          created_by: "admin-1",
          created_at: "2030-01-03T00:00:00Z",
        },
      ]),
    ),
    http.post(
      "/v1/admin/documents/:documentId/classification",
      async ({ params, request }) => {
        const documentId = String(params.documentId);
        requestedTypes[documentId] = (
          (await request.json()) as { document_type: string | null }
        ).document_type;
        return HttpResponse.json(
          {
            job_id: `job-${documentId}`,
            state: "held_for_compute",
            message: "Document saved and waiting.",
            recommended_gpu_minutes: 6,
          },
          { status: 202 },
        );
      },
    ),
    http.post("/v1/admin/compute-sessions/release", async ({ request }) => {
      releasedJobIds = ((await request.json()) as { job_ids: string[] })
        .job_ids;
      return HttpResponse.json({ session_id: "session-1" });
    }),
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
  expect(screen.getByText("classified-policy.pdf")).toBeVisible();
  await userEvent.click(
    screen.getByRole("button", { name: "Needs classification (2)" }),
  );
  expect(screen.queryByText("classified-policy.pdf")).not.toBeInTheDocument();
  expect(screen.getByText("2 of 3 searchable documents shown.")).toBeVisible();
  await userEvent.click(screen.getByLabelText("Select all shown"));
  expect(screen.getByText("2 selected")).toBeVisible();
  const classifyButton = screen.getByRole("button", {
    name: "Apply types & extract data",
  });
  expect(classifyButton).toBeDisabled();
  await userEvent.selectOptions(
    screen.getByLabelText("Classification for invoice.pdf"),
    "accounts_payable.invoice",
  );
  expect(classifyButton).toBeDisabled();
  await userEvent.selectOptions(
    screen.getByLabelText("Classification for credit-note.pdf"),
    "accounts_payable.invoice",
  );
  expect(classifyButton).toBeEnabled();
  await userEvent.click(classifyButton);

  await waitFor(() => {
    expect(requestedTypes).toEqual({
      "document-1": "accounts_payable.invoice",
      "document-2": "accounts_payable.invoice",
    });
    expect(releasedJobIds.sort()).toEqual(["job-document-1", "job-document-2"]);
    expect(onComputeStarted).toHaveBeenCalledWith("session-1");
  });
});
