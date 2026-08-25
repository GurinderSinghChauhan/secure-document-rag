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
    http.get("/v1/chats", () => HttpResponse.json([])),
  );
  renderApplication();
  expect(
    await screen.findByRole("heading", { name: "Ask your documents" }),
  ).toBeVisible();
  expect(screen.getByRole("link", { name: "Admin" })).toHaveAttribute(
    "href",
    "/admin",
  );
  expect(
    screen.queryByRole("link", { name: "Platform Admin" }),
  ).not.toBeInTheDocument();
});
