import type { KnipConfig } from "knip";

// Next.js, Vitest, and Playwright plugins are auto-enabled from devDependencies.
// proxy.ts (middleware) and i18n/request.ts are both auto-detected by the Next.js plugin.
const config: KnipConfig = {
  // Playwright globalTeardown is referenced by path string, not import.
  entry: ["e2e/global-teardown.ts"],
  // Email templates keep a default export for the React Email preview; DB
  // types are generated.
  ignoreIssues: {
    "emails/**": ["exports", "duplicates"],
    "lib/supabase/database.types.ts": ["exports", "types"],
  },
  ignoreDependencies: [
    "shadcn", // CLI tool, not imported in code
  ],
};

export default config;
