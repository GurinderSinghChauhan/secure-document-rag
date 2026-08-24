(function exposeAuthSession(root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.AuthSession = api;
}(typeof globalThis !== "undefined" ? globalThis : window, () => {
  const DEFAULT_LOCK_NAME = "secure-document-rag-auth-refresh";

  class SessionExpiredError extends Error {
    constructor() {
      super("Your session expired. Sign in again.");
      this.name = "SessionExpiredError";
    }
  }

  function createAuthSession({
    fetchImpl = fetch,
    lockManager = typeof navigator !== "undefined" ? navigator.locks : null,
    now = () => Date.now(),
    refreshWindowMs = 30_000,
    lockName = DEFAULT_LOCK_NAME,
    onAuthenticated = () => {},
    onCleared = () => {},
  } = {}) {
    let accessToken = null;
    let accessTokenExpiresAt = 0;
    let authenticationGeneration = 0;
    let refreshPromise = null;
    let loggingOut = false;

    function withRefreshLock(operation) {
      if (lockManager && typeof lockManager.request === "function") {
        return lockManager.request(lockName, { mode: "exclusive" }, operation);
      }
      return operation();
    }

    async function responsePayload(response) {
      const payload = response.status === 204 ? {} : await response.json();
      if (!response.ok) {
        const detail = Array.isArray(payload.detail) ? payload.detail[0]?.msg : payload.detail;
        throw new Error(typeof detail === "string" ? detail : "Authentication request failed.");
      }
      return payload;
    }

    function applyPayload(payload, context = {}, expectedGeneration = null) {
      if (loggingOut || (expectedGeneration !== null && expectedGeneration !== authenticationGeneration)) {
        throw new SessionExpiredError();
      }
      accessToken = payload.access_token;
      accessTokenExpiresAt = now() + (payload.expires_in * 1_000);
      onAuthenticated(payload, context);
      return payload;
    }

    function establish(payload, context = {}) {
      authenticationGeneration += 1;
      loggingOut = false;
      return applyPayload(payload, context, authenticationGeneration);
    }

    function clear({ notify = true } = {}) {
      authenticationGeneration += 1;
      accessToken = null;
      accessTokenExpiresAt = 0;
      if (notify) onCleared();
    }

    function refresh(context = { loadHistory: false }) {
      if (loggingOut) return Promise.reject(new SessionExpiredError());
      if (refreshPromise) return refreshPromise;

      const expectedGeneration = authenticationGeneration;
      const operation = async () => {
        if (loggingOut || expectedGeneration !== authenticationGeneration) throw new SessionExpiredError();
        const response = await fetchImpl("/v1/auth/refresh", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        });
        return applyPayload(await responsePayload(response), context, expectedGeneration);
      };
      const trackedPromise = Promise.resolve(withRefreshLock(operation))
        .finally(() => {
          if (refreshPromise === trackedPromise) refreshPromise = null;
        });
      refreshPromise = trackedPromise;
      return trackedPromise;
    }

    async function expireSession() {
      clear();
      throw new SessionExpiredError();
    }

    async function request(path, options = {}) {
      if (loggingOut) throw new SessionExpiredError();
      if (accessToken && now() >= accessTokenExpiresAt - refreshWindowMs) {
        try {
          await refresh();
        } catch {
          return expireSession();
        }
      }

      const send = () => {
        const headers = new Headers(options.headers || {});
        if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);
        return fetchImpl(path, { credentials: "same-origin", ...options, headers });
      };

      let response = await send();
      if (response.status !== 401) return response;
      try {
        await refresh();
      } catch {
        return expireSession();
      }
      response = await send();
      if (response.status === 401) return expireSession();
      return response;
    }

    async function logout() {
      authenticationGeneration += 1;
      accessToken = null;
      accessTokenExpiresAt = 0;
      loggingOut = true;
      try {
        await withRefreshLock(() => fetchImpl("/v1/auth/logout", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
        }));
      } finally {
        loggingOut = false;
        onCleared();
      }
    }

    return {
      clear,
      establish,
      getAccessToken: () => accessToken,
      logout,
      refresh,
      request,
    };
  }

  return { createAuthSession, SessionExpiredError };
}));
