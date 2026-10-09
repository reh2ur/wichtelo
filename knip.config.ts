import type { KnipConfig } from "knip";

// Next.js, Vitest, and Playwright plugins are auto-enabled from devDependencies.
// proxy.ts (middleware) and i18n/request.ts are both auto-detected by the Next.js plugin.
const config: KnipConfig = {
  ignoreDependencies: [
    "shadcn", // CLI tool, not imported in code
  ],
};

export default config;
