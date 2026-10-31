import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    tsconfigPaths: true,
    // `server-only` throws outside the react-server condition; no-op in tests.
    alias: {
      "server-only": new URL("./vitest.server-only.ts", import.meta.url)
        .pathname,
    },
  },
  test: {
    // Pure logic modules run in node (default). Add @vitest-environment jsdom
    // as a docblock comment in individual files that need DOM APIs.
    environment: "node",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    exclude: ["e2e/**", "node_modules/**", ".next/**", ".claude/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
    },
  },
});
