import { http, HttpResponse } from "msw";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClientProvider } from "@tanstack/react-query";
import { server } from "../test/server";
import { AuthProvider } from "../features/auth";
import { queryClient } from "./queryClient";
import App from "./App";
import type { AuthResponse } from "../api/types";

const adminAuth: AuthResponse = {
  access_token: "test-access-token",
  token_type: "bearer",
  expires_in: 300,
  user: {
    user_id: "user-1",
    email: "admin@example.com",
    display_name: "Admin User",
    role: "admin",
    is_super_admin: false,
    organization: { organization_id: "org-1", name: "Example Organization" },
    trial: {
      active: true,
      ends_at: "2030-01-01T00:00:00Z",
      question_daily_limit: 20,
    },
  },
};

function renderApplication() {
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </QueryClientProvider>,
  );
}

test("shows the authentication gate when a session cannot be restored", async () => {
  server.use(
    http.post("/v1/auth/refresh", () =>
      HttpResponse.json({ detail: "No active session" }, { status: 401 }),
    ),
  );
  renderApplication();
  expect(
    await screen.findByRole("heading", { name: "Sign in to Arcline" }),
  ).toBeVisible();
  expect(screen.getByLabelText("Email")).toBeVisible();
});

test("restores one shared session and exposes role-appropriate navigation", async () => {
  server.use(
    http.post("/v1/auth/refresh", () => HttpResponse.json(adminAuth)),
    http.get("/v1/dashboard", () =>
      HttpResponse.json({
        total_documents: 0,
        classified_documents: 0,
        extracted_documents: 0,
        review_required_documents: 0,
        industries: [],
        recent_documents: [],
      }),
    ),
    http.get("/v1/document-schemas", () => HttpResponse.json([])),
    http.get("/v1/dashboard/documents", () =>
      HttpResponse.json({ total: 0, documents: [] }),
    ),
  );
  renderApplication();
  expect(
    await screen.findByRole("heading", { name: "Document dashboard" }),
  ).toBeVisible();
  expect(screen.getByRole("link", { name: "Ask" })).toHaveAttribute(
    "href",
    "/ask",
  );
  expect(screen.getByRole("link", { name: "Admin" })).toHaveAttribute(
    "href",
    "/admin",
  );
  expect(
    screen.queryByRole("link", { name: "Platform Admin" }),
  ).not.toBeInTheDocument();
});

test("renders authorized document coverage and schema-driven metadata", async () => {
  const documentSearches: string[] = [];
  const dashboardDocument = {
    document_id: "document-1",
    document_name: "service-invoice.pdf",
    document_type: "field_service.service_invoice",
    document_type_label: "Service Invoice",
    industry_key: "field_service",
    industry_label: "Field Service",
    classification_status: "review_required",
    classification_source: "automatic",
    classification_confidence: 0.72,
    extraction_status: "completed",
    extracted_metadata: {
      invoice_number: "INV-42",
      problem_description:
        "First line with enough extracted detail to require a compact preview.\nSecond line continues the document narrative.",
    },
    created_at: "2030-01-01T00:00:00Z",
  };
  const contractDocument = {
    document_id: "document-2",
    document_name: "mutual-nda.pdf",
    document_type: "contract_intelligence.nda",
    document_type_label: "NDA",
    industry_key: "contract_intelligence",
    industry_label: "Contract Intelligence",
    classification_status: "confirmed",
    classification_source: "automatic",
    classification_confidence: 0.94,
    extraction_status: "completed",
    extracted_metadata: { agreement_id: "NDA-7" },
    created_at: "2030-01-02T00:00:00Z",
  };
  server.use(
    http.post("/v1/auth/refresh", () => HttpResponse.json(adminAuth)),
    http.get("/v1/dashboard", () =>
      HttpResponse.json({
        total_documents: 2,
        classified_documents: 2,
        extracted_documents: 2,
        review_required_documents: 1,
        industries: [
          {
            key: "field_service",
            label: "Field Service",
            document_count: 1,
            document_type_count: 1,
          },
          {
            key: "contract_intelligence",
            label: "Contract Intelligence",
            document_count: 1,
            document_type_count: 1,
          },
        ],
        recent_documents: [contractDocument, dashboardDocument],
      }),
    ),
    http.get("/v1/document-schemas", () =>
      HttpResponse.json([
        {
          key: "field_service",
          label: "Field Service",
          description: "Equipment and service operations.",
          document_types: [
            {
              key: "field_service.service_invoice",
              label: "Service Invoice",
              fields: ["invoice_number", "problem_description", "total_amount"],
            },
          ],
        },
        {
          key: "contract_intelligence",
          label: "Contract Intelligence",
          description: "Agreements and obligations.",
          document_types: [
            {
              key: "contract_intelligence.nda",
              label: "NDA",
              fields: ["agreement_id"],
            },
          ],
        },
      ]),
    ),
    http.get("/v1/dashboard/documents", ({ request }) => {
      documentSearches.push(
        new URL(request.url).searchParams.get("query") ?? "",
      );
      return HttpResponse.json({
        total: 2,
        documents: [contractDocument, dashboardDocument],
      });
    }),
  );

  renderApplication();

  expect(
    await screen.findByRole("heading", { name: "Document dashboard" }),
  ).toBeVisible();
  expect(await screen.findByText("service-invoice.pdf")).toBeVisible();
  expect(
    screen.getByText("2 classified documents across 2 configured verticals."),
  ).toBeVisible();
  expect(screen.getByText("invoice_number")).toBeInTheDocument();
  const serviceTable = screen.getByRole("region", {
    name: "Service Invoice extracted data table",
  });
  const contractTable = screen.getByRole("region", {
    name: "NDA extracted data table",
  });
  expect(serviceTable).toBeVisible();
  expect(contractTable).toBeVisible();
  expect(screen.getAllByRole("table")).toHaveLength(2);
  expect(
    within(serviceTable).getByRole("columnheader", { name: "invoice number" }),
  ).toBeVisible();
  expect(
    within(serviceTable).getByRole("columnheader", { name: "total amount" }),
  ).toBeVisible();
  expect(
    within(serviceTable).queryByRole("columnheader", { name: "agreement id" }),
  ).not.toBeInTheDocument();
  expect(
    within(contractTable).getByRole("columnheader", { name: "agreement id" }),
  ).toBeVisible();
  expect(
    within(contractTable).queryByRole("columnheader", {
      name: "invoice number",
    }),
  ).not.toBeInTheDocument();
  expect(
    within(serviceTable).getByRole("cell", { name: "INV-42" }),
  ).toBeVisible();
  expect(
    within(contractTable).getByRole("cell", { name: "NDA-7" }),
  ).toBeVisible();
  const longValue = screen.getByText(/First line with enough extracted detail/);
  expect(longValue).toHaveClass("document-cell-value-text");
  const expandValue = screen.getByRole("button", {
    name: "Show all problem description for service-invoice.pdf",
  });
  expect(expandValue).toHaveAttribute("aria-expanded", "false");
  expect(within(serviceTable).getByRole("cell", { name: "—" })).toBeVisible();
  expect(screen.getByText("Review type")).toBeVisible();
  expect(screen.getByText("Detection confidence: 72%")).toBeVisible();

  const user = userEvent.setup();
  await user.click(expandValue);
  expect(
    screen.getByRole("button", {
      name: "Collapse problem description for service-invoice.pdf",
    }),
  ).toHaveAttribute("aria-expanded", "true");
  await user.type(
    screen.getByRole("searchbox", { name: "Search dashboard documents" }),
    "invoice",
  );
  await waitFor(() => expect(documentSearches).toContain("invoice"));
});
