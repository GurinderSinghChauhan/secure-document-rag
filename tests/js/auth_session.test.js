const assert = require("node:assert/strict");
const test = require("node:test");

const { createAuthSession, SessionExpiredError } = require("../../app/static/auth_session.js");

function response(status, payload = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return payload; },
  };
}

function authPayload(token, expiresIn = 300) {
  return { access_token: token, expires_in: expiresIn, user: { user_id: "user-1" } };
}

class LockManager {
  constructor() {
    this.tail = Promise.resolve();
  }

  request(_name, _options, operation) {
    const result = this.tail.then(operation);
    this.tail = result.catch(() => {});
    return result;
  }
}

test("refreshes an expiring token before sending an authenticated request", async () => {
  const calls = [];
  const session = createAuthSession({
    now: () => 1_000_000,
    fetchImpl: async (path, options) => {
      calls.push({ path, options });
      if (path === "/v1/auth/refresh") return response(200, authPayload("fresh-token"));
      return response(200, { ok: true });
    },
  });
  session.establish(authPayload("old-token", 10));

  await session.request("/v1/chats");

  assert.deepEqual(calls.map(({ path }) => path), ["/v1/auth/refresh", "/v1/chats"]);
  assert.equal(calls[1].options.headers.get("Authorization"), "Bearer fresh-token");
});

test("refreshes once and retries a request after an unauthorized response", async () => {
  let resourceCalls = 0;
  let refreshCalls = 0;
  const session = createAuthSession({
    fetchImpl: async (path, options) => {
      if (path === "/v1/auth/refresh") {
        refreshCalls += 1;
        return response(200, authPayload("replacement-token"));
      }
      resourceCalls += 1;
      if (resourceCalls === 1) return response(401, { detail: "Invalid or expired access token" });
      assert.equal(options.headers.get("Authorization"), "Bearer replacement-token");
      return response(200, { ok: true });
    },
  });
  session.establish(authPayload("old-token"));

  const result = await session.request("/v1/chats");

  assert.equal(result.status, 200);
  assert.equal(refreshCalls, 1);
  assert.equal(resourceCalls, 2);
});

test("serializes refresh rotation across tabs through the shared lock", async () => {
  const lockManager = new LockManager();
  let activeRefreshes = 0;
  let maximumConcurrentRefreshes = 0;
  let refreshCalls = 0;
  const fetchImpl = async () => {
    refreshCalls += 1;
    activeRefreshes += 1;
    maximumConcurrentRefreshes = Math.max(maximumConcurrentRefreshes, activeRefreshes);
    await new Promise((resolve) => setImmediate(resolve));
    activeRefreshes -= 1;
    return response(200, authPayload(`token-${refreshCalls}`));
  };
  const firstTab = createAuthSession({ fetchImpl, lockManager });
  const secondTab = createAuthSession({ fetchImpl, lockManager });

  await Promise.all([firstTab.refresh(), secondTab.refresh()]);

  assert.equal(refreshCalls, 2);
  assert.equal(maximumConcurrentRefreshes, 1);
});

test("coalesces concurrent refresh requests within one tab", async () => {
  let releaseRefresh;
  let refreshCalls = 0;
  const session = createAuthSession({
    fetchImpl: async () => {
      refreshCalls += 1;
      await new Promise((resolve) => { releaseRefresh = resolve; });
      return response(200, authPayload("shared-token"));
    },
  });

  const firstRefresh = session.refresh();
  const secondRefresh = session.refresh();
  assert.equal(firstRefresh, secondRefresh);
  await new Promise((resolve) => setImmediate(resolve));
  releaseRefresh();
  await Promise.all([firstRefresh, secondRefresh]);

  assert.equal(refreshCalls, 1);
});

test("clears authentication when refresh fails", async () => {
  let cleared = 0;
  const session = createAuthSession({
    now: () => 1_000_000,
    onCleared: () => { cleared += 1; },
    fetchImpl: async () => response(401, { detail: "Refresh session expired" }),
  });
  session.establish(authPayload("expired-token", 10));

  await assert.rejects(() => session.request("/v1/chats"), SessionExpiredError);

  assert.equal(session.getAccessToken(), null);
  assert.equal(cleared, 1);
});

test("logout invalidates an in-flight refresh and runs after it releases the lock", async () => {
  const lockManager = new LockManager();
  let releaseRefresh;
  let refreshStarted;
  const refreshStartedPromise = new Promise((resolve) => { refreshStarted = resolve; });
  const applied = [];
  let cleared = 0;
  const calls = [];
  const session = createAuthSession({
    lockManager,
    onAuthenticated: (payload) => applied.push(payload.access_token),
    onCleared: () => { cleared += 1; },
    fetchImpl: async (path) => {
      calls.push(path);
      if (path === "/v1/auth/refresh") {
        refreshStarted();
        await new Promise((resolve) => { releaseRefresh = resolve; });
        return response(200, authPayload("stale-token"));
      }
      return response(204);
    },
  });

  const refreshing = session.refresh().catch((error) => error);
  await refreshStartedPromise;
  const loggingOut = session.logout();
  releaseRefresh();
  const refreshError = await refreshing;
  await loggingOut;

  assert.ok(refreshError instanceof SessionExpiredError);
  assert.deepEqual(applied, []);
  assert.equal(session.getAccessToken(), null);
  assert.equal(cleared, 1);
  assert.deepEqual(calls, ["/v1/auth/refresh", "/v1/auth/logout"]);
});
