import { render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { server } from "../../test/server";
import { AuthGate } from "./AuthGate";
import { AuthContext } from "./context";

function renderGate() {
  render(
    <AuthContext.Provider
      value={{
        status: "anonymous",
        user: null,
        establish: vi.fn(),
        logout: vi.fn(),
      }}
    >
      <AuthGate />
    </AuthContext.Provider>,
  );
}

test("offers Google sign-in when the server is configured", async () => {
  server.use(
    http.get("/v1/auth/google/config", () =>
      HttpResponse.json({ enabled: true }),
    ),
  );
  renderGate();
  expect(
    await screen.findByRole("button", { name: "Continue with Google" }),
  ).toBeVisible();
});

test("shows a useful Google failure and removes it from the URL", async () => {
  server.use(
    http.get("/v1/auth/google/config", () =>
      HttpResponse.json({ enabled: false }),
    ),
  );
  history.replaceState({}, "", "/?google_error=failed");
  renderGate();
  expect(await screen.findByText(/Google sign-in failed/)).toBeVisible();
  expect(location.search).toBe("");
  expect(
    screen.queryByRole("button", { name: "Continue with Google" }),
  ).not.toBeInTheDocument();
});
