# Testing conventions

## Types

- **Unit tests** (Vitest): co-located as `*.test.ts` next to module. Cover Draw Engine, Slug Generator, Name Abbreviator, Group State Machine with all constraint combinations. Use seeded random for determinism.
- **Integration tests** (Vitest + `supabase start`): test Account Deletion Cascade, Invite Token, Notification Dispatcher (mock Resend, real DB). Require local Supabase running. CI job `db-lint` runs `supabase start`, exports creds, runs `pnpm test`, fails if any test skipped (integration suites silently skipping = broken env wiring).
- **E2E tests** (Playwright): live in `e2e/`. Run against Vercel preview URL in CI, or `localhost:3000` locally.

Tests verify external behaviour (inputs → outputs / side effects), not internal implementation.

## Mandatory E2E rule

Every new user-facing flow or page in issue **must** include corresponding `e2e/*.spec.ts` file (or additions to existing spec) in same PR. No E2E follow-ups.

Each spec must cover:

- Golden path
- Access-control / guard checks
- Key error states visible to user

## E2E patterns

- Fixtures in `e2e/fixtures.ts` — `authedPage` gives pre-authenticated admin page, `browser` gives raw browser for guest contexts.
- `guestContextOptions()` and `joinViaInvite()` defined locally per spec file (see `e2e/draw.spec.ts` or `e2e/settings.spec.ts`).
- Wait for Suspense before interacting: `await page.locator("#someField").waitFor({ state: "visible" })`.
- Visible ≠ hydrated. Form in streamed/PPR shell submitted pre-hydration = native POST, action result lost (prerendered shell ignores form state). Form submit button disabled until `useHydrated()` (`lib/use-hydrated.ts`); specs `expect(submit).toBeEnabled()` before programmatic `requestSubmit()`. No sleeps.
- After Server Action mutates data, client calls `router.refresh()` — wait for updated DOM, not fixed timeouts.
- Use `page.reload()` when Server Component must re-fetch from scratch.

## Test backdoors

`/api/test/*` routes + `devOtp` returns gated by `isTestBackdoorEnabled(headers)` (`lib/test-backdoor.ts`). All required: `E2E_TEST_MODE=1`, not Vercel Production + Supabase URL not live ref (`SUPABASE_PROJECT_REF_LIVE`), header `x-e2e-secret` == `E2E_TEST_SECRET` (timing-safe). Else 404 / real OTP mail. E2E send header via `testApiHeaders()` (node fetch) + `browserExtraHeaders()` (browser contexts) from `e2e/helpers.ts`. New route under `/api/test` → use helper, never inline env check. Env setup: `.env.e2e.local.example`.
