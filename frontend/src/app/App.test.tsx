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
  const primaryNavigation = within(screen.getByLabelText("Primary navigation"));
  expect(primaryNavigation.getByRole("link", { name: "Ask" })).toHaveAttribute(
    "href",
    "/ask",
  );
  expect(
    primaryNavigation.getByRole("link", { name: "Admin" }),
  ).toHaveAttribute("href", "/admin");
  expect(
    primaryNavigation.queryByRole("link", { name: "Platform Admin" }),
  ).not.toBeInTheDocument();
  expect(
    screen.getByRole("link", { name: "Skip to main content" }),
  ).toHaveAttribute("href", "#main-content");
  expect(document.querySelector("main#main-content")).toBeInTheDocument();
  expect(screen.getByText(`Arcline v${__APP_VERSION__}`)).toBeVisible();
});

test("renders authorized document coverage and schema-driven metadata", async () => {
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(40);
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(
    function (this: HTMLElement) {
      return this.textContent?.includes("First line with enough") ? 100 : 40;
    },
  );
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
  const secondServiceDocument = {
    document_id: "document-3",
    document_name: "annual-service.pdf",
    document_type: "field_service.service_invoice",
    document_type_label: "Service Invoice",
    industry_key: "field_service",
    industry_label: "Field Service",
    classification_status: "confirmed",
    classification_source: "automatic",
    classification_confidence: 0.91,
    extraction_status: "completed",
    extracted_metadata: {
      invoice_number: "INV-01",
      problem_description: "Annual service visit.",
      total_amount: "100.00",
    },
    created_at: "2029-12-31T00:00:00Z",
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
        total_documents: 3,
        classified_documents: 3,
        extracted_documents: 3,
        review_required_documents: 1,
        industries: [
          {
            key: "field_service",
            label: "Field Service",
            document_count: 2,
            document_type_count: 1,
          },
          {
            key: "contract_intelligence",
            label: "Contract Intelligence",
            document_count: 1,
            document_type_count: 1,
          },
        ],
        recent_documents: [
          contractDocument,
          dashboardDocument,
          secondServiceDocument,
        ],
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
        total: 3,
        documents: [contractDocument, dashboardDocument, secondServiceDocument],
      });
    }),
  );

  renderApplication();

  expect(
    await screen.findByRole("heading", { name: "Document dashboard" }),
  ).toBeVisible();
  expect(
    await screen.findByText(
      "3 classified documents across 2 configured verticals.",
    ),
  ).toBeVisible();
  expect(screen.getByText("invoice_number")).toBeInTheDocument();
  expect(
    screen.getByRole("region", { name: "Field Service document tables" }),
  ).toBeVisible();
  expect(
    screen.getByRole("region", {
      name: "Contract Intelligence document tables",
    }),
  ).toBeVisible();
  const viewServiceTable = screen.getByRole("button", {
    name: "View Field Service Service Invoice table",
  });
  const viewContractTable = screen.getByRole("button", {
    name: "View Contract Intelligence NDA table",
  });
  expect(viewServiceTable).toHaveAttribute("aria-haspopup", "dialog");
  expect(viewContractTable).toHaveAttribute("aria-haspopup", "dialog");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.queryAllByRole("table")).toHaveLength(0);

  const user = userEvent.setup();
  await user.click(viewServiceTable);

  expect(await screen.findByText("service-invoice.pdf")).toBeVisible();
  const serviceDialog = screen.getByRole("dialog", {
    name: "Service Invoice",
  });
  const serviceTable = within(serviceDialog).getByRole("region", {
    name: "Service Invoice extracted data table",
  });
  expect(serviceDialog).toBeVisible();
  expect(serviceTable).toBeVisible();
  expect(
    within(serviceDialog).getByRole("link", { name: "Insights" }),
  ).toHaveAttribute("href", "/insights/field_service.service_invoice");
  expect(screen.getAllByRole("table")).toHaveLength(1);
  expect(
    within(serviceTable).getByRole("columnheader", { name: /invoice number/ }),
  ).toBeVisible();
  expect(
    within(serviceTable).getByRole("columnheader", { name: /total amount/ }),
  ).toBeVisible();
  expect(
    within(serviceTable).queryByRole("columnheader", {
      name: /Classification/,
    }),
  ).not.toBeInTheDocument();
  expect(
    within(serviceTable).queryByRole("columnheader", { name: /Extraction/ }),
  ).not.toBeInTheDocument();
  expect(
    within(serviceTable).queryByRole("columnheader", { name: /agreement id/ }),
  ).not.toBeInTheDocument();
  expect(
    within(serviceTable).getByRole("cell", { name: "INV-42" }),
  ).toBeVisible();
  const sortDocuments = within(serviceTable).getByRole("button", {
    name: "Sort by Document ascending",
  });
  await user.click(sortDocuments);
  expect(
    within(serviceTable).getByRole("columnheader", { name: /Document/ }),
  ).toHaveAttribute("aria-sort", "ascending");
  expect(within(serviceTable).getAllByRole("rowheader")[0]).toHaveTextContent(
    "annual-service.pdf",
  );
  await user.click(
    within(serviceTable).getByRole("button", {
      name: "Sort by Document descending",
    }),
  );
  expect(
    within(serviceTable).getByRole("columnheader", { name: /Document/ }),
  ).toHaveAttribute("aria-sort", "descending");
  expect(within(serviceTable).getAllByRole("rowheader")[0]).toHaveTextContent(
    "service-invoice.pdf",
  );

  await user.type(
    within(serviceTable).getByRole("searchbox", {
      name: "Filter invoice number",
    }),
    "INV-42",
  );
  expect(
    within(serviceTable).queryByText("annual-service.pdf"),
  ).not.toBeInTheDocument();
  expect(within(serviceDialog).getByText("Showing 1 of 2 rows")).toBeVisible();
  await user.click(
    within(serviceDialog).getByRole("button", { name: "Reset table view" }),
  );
  expect(within(serviceTable).getByText("annual-service.pdf")).toBeVisible();
  const longValue = screen.getByText(/First line with enough extracted detail/);
  expect(longValue).toHaveClass("document-cell-value-text");
  const expandValue = screen.getByRole("button", {
    name: "Show all problem description for service-invoice.pdf",
  });
  expect(expandValue).toHaveAttribute("aria-expanded", "false");
  expect(
    screen.queryByRole("button", {
      name: "Show all problem description for annual-service.pdf",
    }),
  ).not.toBeInTheDocument();
  expect(within(serviceTable).getByRole("cell", { name: "—" })).toBeVisible();

  await user.click(expandValue);
  expect(
    screen.getByRole("button", {
      name: "Collapse problem description for service-invoice.pdf",
    }),
  ).toHaveAttribute("aria-expanded", "true");
  await user.click(
    within(serviceDialog).getByRole("button", {
      name: "Close Service Invoice table",
    }),
  );
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(viewServiceTable).toHaveFocus();

  await user.click(viewContractTable);
  const contractDialog = screen.getByRole("dialog", { name: "NDA" });
  const contractTable = within(contractDialog).getByRole("region", {
    name: "NDA extracted data table",
  });
  expect(
    within(contractTable).getByRole("columnheader", { name: /agreement id/ }),
  ).toBeVisible();
  expect(
    within(contractTable).queryByRole("columnheader", {
      name: /invoice number/,
    }),
  ).not.toBeInTheDocument();
  expect(
    within(contractTable).getByRole("cell", { name: "NDA-7" }),
  ).toBeVisible();
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(viewContractTable).toHaveFocus();
  await user.type(
    screen.getByRole("searchbox", { name: "Search dashboard documents" }),
    "invoice",
  );
  await waitFor(() => expect(documentSearches).toContain("invoice"));
});

test("renders adaptive diagrams for an authorized document type", async () => {
  window.history.pushState({}, "", "/insights/field_service.service_invoice");
  const insightDocuments = [
    {
      document_id: "insight-1",
      document_name: "invoice-one.pdf",
      document_type: "field_service.service_invoice",
      document_type_label: "Service Invoice",
      industry_key: "field_service",
      industry_label: "Field Service",
      classification_status: "confirmed",
      classification_source: "automatic",
      classification_confidence: 0.95,
      extraction_status: "completed",
      extracted_metadata: {
        invoice_number: "INV-1",
        invoice_date: "2030-01-10",
        customer_name: "Acme",
        payment_status: "Paid",
        total_amount: "250.00",
        due_date: "2030-02-10",
      },
      created_at: "2030-01-11T00:00:00Z",
    },
    {
      document_id: "insight-2",
      document_name: "invoice-two.pdf",
      document_type: "field_service.service_invoice",
      document_type_label: "Service Invoice",
      industry_key: "field_service",
      industry_label: "Field Service",
      classification_status: "confirmed",
      classification_source: "manual",
      classification_confidence: null,
      extraction_status: "completed",
      extracted_metadata: {
        invoice_number: "INV-2",
        invoice_date: "2030-02-12",
        customer_name: "Beta",
        payment_status: "Due",
        total_amount: "400.00",
        due_date: "2030-03-12",
      },
      created_at: "2030-02-13T00:00:00Z",
    },
  ];
  server.use(
    http.post("/v1/auth/refresh", () => HttpResponse.json(adminAuth)),
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
              fields: [
                "invoice_number",
                "invoice_date",
                "customer_name",
                "payment_status",
                "total_amount",
                "due_date",
              ],
            },
          ],
        },
      ]),
    ),
    http.get("/v1/dashboard/documents", ({ request }) => {
      expect(new URL(request.url).searchParams.get("query")).toBe(
        "field_service.service_invoice",
      );
      return HttpResponse.json({ total: 2, documents: insightDocuments });
    }),
  );

  renderApplication();

  expect(
    await screen.findByRole("heading", { name: "Service Invoice insights" }),
  ).toBeVisible();
  expect(
    screen.getByRole("link", { name: "← Back to document tables" }),
  ).toHaveAttribute("href", "/");
  expect(screen.getByRole("region", { name: "Insight summary" })).toBeVisible();
  expect(screen.getByRole("region", { name: "Quick read" })).toBeVisible();
  expect(
    screen.getByRole("region", { name: "Insight coverage" }),
  ).toHaveTextContent("100%");
  expect(
    screen.getByRole("region", { name: "Insight diagrams" }),
  ).toBeVisible();
  expect(
    screen.getByRole("heading", { name: "invoice date volume over time" }),
  ).toBeVisible();
  expect(
    screen.getByRole("heading", { name: "payment status breakdown" }),
  ).toBeVisible();
  expect(
    screen.getByRole("heading", { name: "total amount by document" }),
  ).toBeVisible();
  expect(
    screen.getByRole("heading", { name: "Top customer name" }),
  ).toBeVisible();
  expect(
    screen.getByRole("heading", { name: "Deadline timeline" }),
  ).toBeVisible();
  expect(
    screen.getByRole("heading", { name: "Extracted-field completeness" }),
  ).toBeVisible();
  expect(
    screen.getByRole("img", { name: "Document volume trend" }),
  ).toBeVisible();
  expect(screen.getByRole("img", { name: "Value distribution" })).toBeVisible();
});
