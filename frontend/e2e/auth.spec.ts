import { expect, test } from "@playwright/test";

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
