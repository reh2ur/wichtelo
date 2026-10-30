import "@testing-library/jest-dom/vitest";

// Canonical origin required by lib/site-url.ts in production-mode tests.
process.env.NEXT_PUBLIC_SITE_URL ??= "https://wichtelo.example";

// HMAC secret for rate-limit keys (lib/rate-limit-key.ts) in production-mode tests.
process.env.ACCOUNT_DELETION_SECRET ??= "x".repeat(32);
