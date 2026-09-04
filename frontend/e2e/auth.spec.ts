import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

async function expectNoAccessibilityViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(
    results.violations,
    results.violations
      .map((violation) => `${violation.id}: ${violation.help}`)
      .join("\n"),
  ).toEqual([]);
}

test("direct SPA navigation falls back to the sign-in experience", async ({
  page,
}) => {
  await page.route("**/v1/auth/refresh", (route) =>
    route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ detail: "No active session" }),
    }),
  );
  await page.goto("/admin");
  await expect(
    page.getByRole("heading", { name: "Sign in to Arcline" }),
  ).toBeVisible();
  await expect(page.getByLabel("Email")).toBeVisible();
  await expectNoAccessibilityViolations(page);
});

test("an administrator navigates across lazy routes without reloading the session", async ({
  page,
}) => {
  let refreshCalls = 0;
  await page.route("**/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/v1/auth/refresh") {
      refreshCalls += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          access_token: "browser-token",
          token_type: "bearer",
          expires_in: 300,
          user: {
            user_id: "admin-1",
            email: "admin@example.com",
            display_name: "Admin User",
            role: "admin",
            is_super_admin: true,
            organization: { organization_id: "org-1", name: "Example Org" },
            trial: {
              active: true,
              ends_at: "2030-01-01T00:00:00Z",
              question_daily_limit: 20,
            },
          },
        }),
      });
      return;
    }
    if (path === "/v1/dashboard") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          total_documents: 0,
          classified_documents: 0,
          extracted_documents: 0,
          review_required_documents: 0,
          industries: [],
          recent_documents: [],
        }),
      });
      return;
    }
    if (path === "/v1/dashboard/documents") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ total: 0, documents: [] }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([]),
    });
  });

  await page.goto("/admin");
  await expect(
    page.getByRole("heading", { name: "Workspace control center" }),
  ).toBeVisible();
  await expectNoAccessibilityViolations(page);
  await page.evaluate(() => {
    (window as typeof window & { __spaMarker?: boolean }).__spaMarker = true;
  });

  await page.getByRole("link", { name: "Ask" }).click();
  await expect(
    page.getByRole("heading", { name: "Ask your documents" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Platform Admin" }).click();
  await expect(
    page.getByRole("heading", { name: "Platform oversight" }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Response quality" }).click();
  await expect(
    page.getByRole("heading", { name: "Chat response evaluator" }),
  ).toBeVisible();

  expect(
    await page.evaluate(
      () => (window as typeof window & { __spaMarker?: boolean }).__spaMarker,
    ),
  ).toBe(true);
  expect(refreshCalls).toBe(1);
});

test("phone layout keeps role-appropriate navigation and admin actions available", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/v1/auth/refresh") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          access_token: "mobile-token",
          token_type: "bearer",
          expires_in: 300,
          user: {
            user_id: "admin-1",
            email: "admin@example.com",
            display_name: "Admin User",
            role: "admin",
            is_super_admin: false,
            organization: { organization_id: "org-1", name: "Example Org" },
            trial: {
              active: true,
              ends_at: "2030-01-01T00:00:00Z",
              question_daily_limit: 20,
            },
          },
        }),
      });
      return;
    }
    if (path === "/v1/dashboard") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          total_documents: 0,
          classified_documents: 0,
          extracted_documents: 0,
          review_required_documents: 0,
          industries: [],
          recent_documents: [],
        }),
      });
      return;
    }
    if (path === "/v1/dashboard/documents") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ total: 0, documents: [] }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([]),
    });
  });

  await page.goto("/");
  const mobileNavigation = page.getByRole("navigation", {
    name: "Mobile navigation",
  });
  await expect(mobileNavigation).toBeVisible();
  await expect(
    mobileNavigation.getByRole("link", { name: "Ask" }),
  ).toBeVisible();
  await mobileNavigation.getByRole("link", { name: "Admin" }).click();
  await expect(
    page.getByRole("heading", { name: "Workspace control center" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Delete all documents" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("insights remain polished and usable on a phone viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/v1/auth/refresh") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          access_token: "insights-token",
          token_type: "bearer",
          expires_in: 300,
          user: {
            user_id: "admin-1",
            email: "admin@example.com",
            display_name: "Admin User",
            role: "admin",
            is_super_admin: false,
            organization: { organization_id: "org-1", name: "Example Org" },
          },
        }),
      });
      return;
    }
    if (path === "/v1/document-schemas") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            key: "field_service",
            label: "Field Service",
            description: "Service operations.",
            document_types: [
              {
                key: "field_service.service_invoice",
                label: "Service Invoice",
                fields: [
                  "invoice_date",
                  "payment_status",
                  "total_amount",
                  "due_date",
                ],
              },
            ],
          },
        ]),
      });
      return;
    }
    if (path === "/v1/dashboard/documents") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          total: 1,
          documents: [
            {
              document_id: "invoice-1",
              document_name: "service-invoice.pdf",
              document_type: "field_service.service_invoice",
              document_type_label: "Service Invoice",
              industry_key: "field_service",
              industry_label: "Field Service",
              classification_status: "confirmed",
              classification_source: "automatic",
              classification_confidence: 0.96,
              extraction_status: "completed",
              extracted_metadata: {
                invoice_date: "2030-01-10",
                payment_status: "Paid",
                total_amount: "250.00",
                due_date: "2030-02-10",
              },
              created_at: "2030-01-11T00:00:00Z",
            },
          ],
        }),
      });
      return;
    }
    await route.fulfill({ status: 404 });
  });

  await page.goto("/insights/field_service.service_invoice");
  await expect(
    page.getByRole("heading", { name: "Service Invoice insights" }),
  ).toBeVisible();
  await expect(page.getByRole("region", { name: "Quick read" })).toBeVisible();
  await expect(
    page.getByRole("img", { name: "Value distribution" }),
  ).toBeVisible();
  await expect(
    page.getByRole("img", { name: "Document volume trend" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
