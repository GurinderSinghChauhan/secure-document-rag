import { http, HttpResponse } from "msw";
import { render, screen } from "@testing-library/react";
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
  server.use(
    http.post("/v1/auth/refresh", () => HttpResponse.json(adminAuth)),
    http.get("/v1/dashboard", () =>
      HttpResponse.json({
        total_documents: 1,
        classified_documents: 1,
        extracted_documents: 1,
        review_required_documents: 1,
        industries: [
          {
            key: "field_service",
            label: "Field Service",
            document_count: 1,
            document_type_count: 1,
          },
        ],
        recent_documents: [
          {
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
            extracted_metadata: { invoice_number: "INV-42" },
            created_at: "2030-01-01T00:00:00Z",
          },
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
              fields: ["invoice_number", "total_amount"],
            },
          ],
        },
      ]),
    ),
  );

  renderApplication();

  expect(
    await screen.findByRole("heading", { name: "Document dashboard" }),
  ).toBeVisible();
  expect(await screen.findByText("service-invoice.pdf")).toBeVisible();
  expect(
    screen.getByText("1 classified documents across 1 configured verticals."),
  ).toBeVisible();
  expect(screen.getByText("invoice_number")).toBeInTheDocument();
  expect(screen.getByText("Review type")).toBeVisible();
  expect(screen.getByText("Detection confidence: 72%")).toBeVisible();
});
