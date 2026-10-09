import "@testing-library/jest-dom";

// Canonical origin required by lib/site-url.ts in production-mode tests.
process.env.NEXT_PUBLIC_SITE_URL ??= "https://wichtelo.example";
