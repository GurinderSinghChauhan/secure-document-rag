import { http, HttpResponse } from "msw";
import { ApiClient, SessionExpiredError, api } from "./client";
import { server } from "../test/server";
import type { AuthResponse } from "./types";

const auth: AuthResponse = {
  access_token: "old-token",
  token_type: "bearer",
  expires_in: 300,
  user: {
    user_id: "user-1",
    email: "member@example.com",
    display_name: "Member",
    role: "member",
    is_super_admin: false,
    organization: { organization_id: "org-1", name: "Example" },
    trial: {
      active: true,
      ends_at: "2030-01-01T00:00:00Z",
      question_daily_limit: 20,
    },
  },
};

test("refreshes once after a 401 and retries with the new in-memory token", async () => {
  let protectedCalls = 0;
  let refreshCalls = 0;
  server.use(
    http.get("/protected", ({ request }) => {
      protectedCalls += 1;
      return request.headers.get("authorization") === "Bearer new-token"
        ? HttpResponse.json({ ok: true })
        : HttpResponse.json({ detail: "expired" }, { status: 401 });
    }),
    http.post("/v1/auth/refresh", () => {
      refreshCalls += 1;
      return HttpResponse.json({ ...auth, access_token: "new-token" });
    }),
  );
  api.establish(auth);
  const result = await api.json<{ ok: boolean }>("/protected");
  expect(result.ok).toBe(true);
  expect(protectedCalls).toBe(2);
  expect(refreshCalls).toBe(1);
});

function response(status: number, body: unknown = {}) {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function requestPath(input: RequestInfo | URL) {
  if (input instanceof Request) return new URL(input.url).pathname;
  if (input instanceof URL) return input.pathname;
  return input;
}

class LockManager {
  private tail: Promise<unknown> = Promise.resolve();

  request<T>(
    _name: string,
    _options: { mode: "exclusive" },
    operation: () => Promise<T>,
  ): Promise<T> {
    const result = this.tail.then(operation);
    this.tail = result.catch(() => undefined);
    return result;
  }
}

test("refreshes an expiring token before an authenticated request", async () => {
  const calls: Array<{ path: string; authorization: string | null }> = [];
  const fetchImpl = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const path = requestPath(input);
    const authorization = new Headers(init?.headers).get("Authorization");
    calls.push({ path, authorization });
    if (path === "/v1/auth/refresh")
      return Promise.resolve(
        response(200, { ...auth, access_token: "fresh-token" }),
      );
    return Promise.resolve(response(200, { ok: true }));
  }) as unknown as typeof fetch;
  const client = new ApiClient({
    fetchImpl,
    lockManager: null,
    now: () => 1_000_000,
  });
  client.establish({ ...auth, expires_in: 10 });

  await client.request("/v1/chats");

  expect(calls.map(({ path }) => path)).toEqual([
    "/v1/auth/refresh",
    "/v1/chats",
  ]);
  expect(calls[1]?.authorization).toBe("Bearer fresh-token");
});

test("coalesces concurrent refreshes within one application", async () => {
  let release: (() => void) | undefined;
  const fetchImpl = vi.fn(
    () =>
      new Promise<Response>((resolve) => {
        release = () => resolve(response(200, auth));
      }),
  ) as unknown as typeof fetch;
  const client = new ApiClient({ fetchImpl, lockManager: null });

  const first = client.refresh();
  const second = client.refresh();
  expect(first).toBe(second);
  release?.();
  await Promise.all([first, second]);

  expect(fetchImpl).toHaveBeenCalledTimes(1);
});

test("serializes refresh token rotation across browser contexts", async () => {
  const lockManager = new LockManager();
  let active = 0;
  let maximum = 0;
  const fetchImpl = vi.fn(async () => {
    active += 1;
    maximum = Math.max(maximum, active);
    await Promise.resolve();
    active -= 1;
    return response(200, auth);
  }) as unknown as typeof fetch;

  await Promise.all([
    new ApiClient({ fetchImpl, lockManager }).refresh(),
    new ApiClient({ fetchImpl, lockManager }).refresh(),
  ]);

  expect(fetchImpl).toHaveBeenCalledTimes(2);
  expect(maximum).toBe(1);
});

test("clears authentication when refresh fails", async () => {
  const listener = vi.fn();
  const client = new ApiClient({
    fetchImpl: vi.fn(() =>
      Promise.resolve(response(401, { detail: "Refresh expired" })),
    ) as unknown as typeof fetch,
    lockManager: null,
    now: () => 1_000_000,
  });
  client.setAuthListener(listener);
  client.establish({ ...auth, expires_in: 10 });

  await expect(client.request("/v1/chats")).rejects.toBeInstanceOf(
    SessionExpiredError,
  );
  expect(client.getAccessToken()).toBeNull();
  expect(listener).toHaveBeenLastCalledWith(null);
});

test("logout invalidates an in-flight refresh and waits for its lock", async () => {
  const lockManager = new LockManager();
  let releaseRefresh: (() => void) | undefined;
  let markStarted: (() => void) | undefined;
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  const calls: string[] = [];
  const listener = vi.fn();
  const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
    const path = requestPath(input);
    calls.push(path);
    if (path === "/v1/auth/refresh") {
      markStarted?.();
      await new Promise<void>((resolve) => {
        releaseRefresh = resolve;
      });
      return response(200, { ...auth, access_token: "stale-token" });
    }
    return response(204);
  }) as unknown as typeof fetch;
  const client = new ApiClient({ fetchImpl, lockManager });
  client.setAuthListener(listener);

  const refreshing = client.refresh().catch((error: unknown) => error);
  await started;
  const loggingOut = client.logout();
  releaseRefresh?.();
  const refreshError = await refreshing;
  await loggingOut;

  expect(refreshError).toBeInstanceOf(SessionExpiredError);
  expect(client.getAccessToken()).toBeNull();
  expect(listener).toHaveBeenCalledTimes(1);
  expect(listener).toHaveBeenCalledWith(null);
  expect(calls).toEqual(["/v1/auth/refresh", "/v1/auth/logout"]);
});
