import { readFileSync } from "node:fs";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig(({ command }) => {
  const version = readFileSync(
    new URL("../VERSION", import.meta.url),
    "utf8",
  ).trim();
  const commit = process.env.VITE_APP_COMMIT?.trim() || "development";
  const voiceInputEnabled = process.env.VITE_VOICE_INPUT_ENABLED === "true";

  return {
    base: command === "build" ? "/assets/spa/" : "/",
    define: {
      __APP_COMMIT__: JSON.stringify(commit),
      __APP_VERSION__: JSON.stringify(version),
      __VOICE_INPUT_ENABLED__: JSON.stringify(voiceInputEnabled),
    },
    plugins: [react()],
    build: {
      outDir: "../app/static/spa",
      emptyOutDir: true,
      sourcemap: false,
    },
    server: {
      port: 5173,
      proxy: {
        "/v1": "http://127.0.0.1:8080",
        "/healthz": "http://127.0.0.1:8080",
        "/readyz": "http://127.0.0.1:8080",
      },
    },
    test: {
      environment: "jsdom",
      globals: true,
      include: ["src/**/*.test.{ts,tsx}"],
      setupFiles: "./src/test/setup.ts",
      restoreMocks: true,
    },
  };
});
