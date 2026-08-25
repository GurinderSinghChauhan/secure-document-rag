import type { AuthResponse } from "./types";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export class SessionExpiredError extends Error {
  constructor() {
    super("Your session expired. Sign in again.");
    this.name = "SessionExpiredError";
  }
}

async function payload(response: Response): Promise<unknown> {
  if (response.status === 204) return {};
  return response.json().catch(() => ({}));
}

export function errorMessage(value: unknown, fallback: string): string {
  if (!value || typeof value !== "object") return fallback;
  const detail = (value as { detail?: unknown }).detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail) && detail[0] && typeof detail[0] === "object") {
    const message = (detail[0] as { msg?: unknown }).msg;
    if (typeof message === "string") return message;
  }
  return fallback;
}

type AuthListener = (auth: AuthResponse | null) => void;

interface RefreshLockManager {
  request<T>(
    name: string,
    options: { mode: "exclusive" },
    operation: () => Promise<T>,
  ): Promise<T>;
}

interface ApiClientOptions {
  fetchImpl?: typeof fetch;
  lockManager?: RefreshLockManager | null;
  now?: () => number;
}

export class ApiClient {
  private accessToken: string | null = null;
  private expiresAt = 0;
  private generation = 0;
  private refreshPromise: Promise<AuthResponse> | null = null;
  private listener: AuthListener = () => undefined;
  private readonly fetchImpl: typeof fetch;
  private readonly lockManager: RefreshLockManager | null;
  private readonly now: () => number;

  constructor({
    fetchImpl = (input, init) => globalThis.fetch(input, init),
    lockManager = typeof navigator === "undefined" ? null : navigator.locks,
    now = () => Date.now(),
  }: ApiClientOptions = {}) {
    this.fetchImpl = fetchImpl;
    this.lockManager = lockManager;
    this.now = now;
  }

  setAuthListener(listener: AuthListener) {
    this.listener = listener;
  }

  getAccessToken() {
    return this.accessToken;
  }

  establish(auth: AuthResponse) {
    this.generation += 1;
    this.apply(auth, this.generation);
  }

  clear(notify = true) {
    this.generation += 1;
    this.accessToken = null;
    this.expiresAt = 0;
    if (notify) this.listener(null);
  }

  private apply(auth: AuthResponse, expectedGeneration: number) {
    if (expectedGeneration !== this.generation) throw new SessionExpiredError();
    this.accessToken = auth.access_token;
    this.expiresAt = this.now() + auth.expires_in * 1000;
    this.listener(auth);
    return auth;
  }

  async authRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
    const response = await this.fetchImpl(path, {
      credentials: "same-origin",
      ...options,
      headers: { "Content-Type": "application/json", ...options.headers },
    });
    const data = await payload(response);
    if (!response.ok)
      throw new ApiError(
        errorMessage(data, "Authentication request failed."),
        response.status,
      );
    return data as T;
  }

  private withRefreshLock<T>(operation: () => Promise<T>): Promise<T> {
    if (this.lockManager)
      return this.lockManager.request(
        "secure-document-rag-auth-refresh",
        { mode: "exclusive" },
        operation,
      );
    return operation();
  }

  refresh(): Promise<AuthResponse> {
    if (this.refreshPromise) return this.refreshPromise;
    const expectedGeneration = this.generation;
    const refreshOperation = async () => {
      const response = await this.fetchImpl("/v1/auth/refresh", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const data = await payload(response);
      if (!response.ok)
        throw new ApiError(
          errorMessage(data, "Unable to restore your session."),
          response.status,
        );
      return this.apply(data as AuthResponse, expectedGeneration);
    };
    this.refreshPromise = this.withRefreshLock(refreshOperation).finally(() => {
      this.refreshPromise = null;
    });
    return this.refreshPromise;
  }

  async request(path: string, options: RequestInit = {}): Promise<Response> {
    if (this.accessToken && this.now() >= this.expiresAt - 30_000) {
      try {
        await this.refresh();
      } catch {
        this.clear();
        throw new SessionExpiredError();
      }
    }
    const send = () => {
      const headers = new Headers(options.headers);
      if (this.accessToken)
        headers.set("Authorization", `Bearer ${this.accessToken}`);
      return this.fetchImpl(path, {
        credentials: "same-origin",
        ...options,
        headers,
      });
    };
    let response = await send();
    if (response.status !== 401) return response;
    try {
      await this.refresh();
    } catch {
      this.clear();
      throw new SessionExpiredError();
    }
    response = await send();
    if (response.status === 401) {
      this.clear();
      throw new SessionExpiredError();
    }
    return response;
  }

  async json<T>(
    path: string,
    options: RequestInit = {},
    fallback = "Unable to complete the request.",
  ): Promise<T> {
    const response = await this.request(path, options);
    const data = await payload(response);
    if (!response.ok)
      throw new ApiError(errorMessage(data, fallback), response.status);
    return data as T;
  }

  async logout() {
    this.generation += 1;
    this.accessToken = null;
    this.expiresAt = 0;
    try {
      await this.withRefreshLock(() =>
        this.fetchImpl("/v1/auth/logout", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
        }),
      );
    } finally {
      this.listener(null);
    }
  }
}

export const api = new ApiClient();
