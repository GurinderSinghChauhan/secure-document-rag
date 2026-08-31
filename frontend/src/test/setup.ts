import "@testing-library/jest-dom/vitest";
import { afterAll, afterEach, beforeAll } from "vitest";
import { cleanup } from "@testing-library/react";
import { server } from "./server";
import { api } from "../api/client";
import { queryClient } from "../app/queryClient";

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  cleanup();
  server.resetHandlers();
  api.clear(false);
  queryClient.clear();
  window.history.replaceState({}, "", "/");
});
afterAll(() => server.close());
