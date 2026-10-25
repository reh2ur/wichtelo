# CLAUDE.md

Claude Code guidance for this repo. **Style rule:** all additions/edits to this file and `docs/` must use caveman-compressed prose — no articles, no filler, fragments OK. Match existing register.

## What this project is

Secret Santa = German-language web app for gift exchange groups ("Wichteln"). Users join via shareable invite links, admin triggers random draw, everyone notified of recipient. Full domain context + user stories in `docs/prd.md`.

## Commands

```bash
wt dev            # start dev server (Turbopack), port per worktree — use this, not `pnpm dev`
pnpm build        # production build (Turbopack)
pnpm format       # prettier --write . (auto-fix formatting)
pnpm lint         # ESLint
pnpm typecheck    # tsc --noEmit
pnpm test         # Vitest unit + integration tests
pnpm test:watch   # Vitest in watch mode
pnpm db:lint      # supabase db lint (needs supabase start; runs in CI job db-lint)
pnpm test -- path/to/file.test.ts          # run a single test file
pnpm test -- -t "test name"               # run tests matching a name
pnpm e2e:dev      # Playwright E2E against local dev server
pnpm e2e:pr <NUM> # Playwright E2E against Vercel preview for PR number
supabase start    # start local Supabase stack (required for integration tests)
supabase stop     # stop local Supabase stack
```

## Stack

- **Next.js 16**, App Router, React 19, React Compiler, Turbopack (default for dev + build)
- **Middleware** lives in `proxy.ts` (root) — `middleware.ts` deprecated name; do NOT rename or flag `proxy.ts` as incorrect
- **pnpm** as package manager
- **Supabase** — PostgreSQL + Auth (magic link + OTP). EU Frankfurt region in prod, local stack for dev/tests.
- **Resend** + **React Email** — all transactional email. OTP/magic-link/signup-confirm mail sent by Supabase Auth direct, not Resend — styled via `supabase/templates/{magic_link,confirmation}.html` (Go template, no React Email). Edit `emails/components/theme.ts` or `wichtel-layout.tsx` → mirror change into both those files too, else auth mail drifts from rest of brand. Auth mail button link = `{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=email` → app confirm page (`/auth/callback`, `/einladung/[token]/magiclink`), never `{{ .ConfirmationURL }}` (see `docs/security.md`). Push template changes to prod via `supabase config push` (needs `supabase link` first) — editing `config.toml` alone only affects local stack.
- **Email Reply-To:** none set, deliberate. Replies hit `RESEND_FROM_EMAIL` (unmonitored). Admin email already shown in body of draw/group-deleted mail for members who already know admin (PRD #33); Reply-To would push it into every reply header + forwards → no extra exposure policy wanted. Admin contact stays explicit in body only. Revisit only w/ dedicated monitored inbox. Every mail footer: Impressum + Datenschutz links (`wichtel-layout.tsx`, mirrored in `supabase/templates/*.html`). Draw mail has CTA → `/gruppen/[slug]`.
- **Impressum operator** — name/address/contact from env `OPERATOR_*` (`lib/operator.ts`), ICU-interpolated into `messages/de.json`; required in prod via `lib/env.ts`. Never hardcode personal data in repo.
- **next-intl** — German only, no locale URL prefix. Server Components use `getTranslations()`. Client Components use `createIntlContext` factory (see Translations rule below)
- **shadcn/ui** with **Base UI** primitives (not Radix), **Tailwind CSS**, **Manrope** font via `next/font/google`
- **@phosphor-icons/react** — icons. Import from `@phosphor-icons/react/ssr`. Always use `Icon`-suffixed exports (`ArrowLeftIcon`, not `ArrowLeft` — bare exports deprecated).
- **Vitest** (unit + integration), **Playwright** (E2E)

## next.config.ts

```ts
{
  cacheComponents: true,      // enables `use cache` directive + PPR
  reactCompiler: true,
  experimental: { turbopackFileSystemCacheForDev: true }
}
```

## Design system

Full design spec (palette, tokens, components, icon rules) in **`docs/design.md`** — read before building new UI.

## Architecture rules

**Server-first.** Default to Server Components. Add `'use client'` only when required by Base UI interactive primitives or CSS snow animation.

**Mutations via Server Actions.** Use `useActionState` (React 19) for form state. No API route handlers for mutations.

**Caching.** `'use cache'` only for data safe to serve stale. Default `use cache` handler = per-process in-memory; on Vercel `updateTag` expiry not verified to reach other instances → silent stale reads. So NO `'use cache'` on mutable per-group data (member list, state, draw button). Wrap dynamic data (assignment reveal, live participant count, group data) in `<Suspense>` islands. Dynamic data access outside `<Suspense>` or `use cache` throws build-time error — framework-enforced. Want caching back → use `'use cache: remote'` or verify on real Vercel preview first (#95).

**Cache tag registry.** All cache tags defined in `lib/cache-tags.ts` — `groupTag(slug)` and `inviteTag(token)`. Import from there; never hardcode tag strings inline. `inviteTag` reserved for future use — `resolveToken` uncached (see below), no `cacheTag`/`updateTag` call references it yet. Currently NO `cacheTag` consumer exists at all (see below); `groupTag` only used by `updateTag` calls.

**`use cache` functions and their tags:** none.

- `fetchGroupData(slug)` in `app/gruppen/[gruppeId]/page.tsx` intentionally uncached (#95) — reads fresh every request, throws on DB error. Page already dynamic per request (session + membership check), so cache bought little.

**`resolveToken(token)` in `lib/invite/index.ts` intentionally uncached** — always reads fresh, so dead-end state (`group.state === "drawn"`) shows correctly without any invalidation wiring. If caching added later, MUST add `cacheTag(inviteTag(token))` inside `resolveToken` AND `updateTag(inviteTag(token))` at both draw-trigger sites below — else stale invite can incorrectly hide a drawn group's dead-end state.

**`resolveToken` contact name** (`adminName`, dead-end copy) = oldest live admin membership (`profile_id` not null), looked up only when `state === "drawn"`, else `""`. Never `groups.created_by` — nullable (`ON DELETE SET NULL` on creator account deletion), `.eq("id", null)` would break invite page. Same null guard in admin group pages.

**Invite page exposure.** `/einladung/[token]` shows group name only (+ admin first name/initial on drawn dead end). `budget_hint`/`note` NOT selected by `resolveToken`, never shown to link holder — members only (matches `datenschutz.memberVisibility`). Rate-limit keys for email = `rateLimitKey(email)` (`lib/rate-limit-key.ts`, HMAC w/ `ACCOUNT_DELETION_SECRET`) — raw email never goes to Upstash.

**Invite rotation.** `rotateToken(groupId)` (`lib/invite`) overwrites token in place (one row per group) → old link hits invalid-token page. Admin action `regenerateInviteLink` in settings, open groups only, calls `updateTag(groupTag(slug))`. No migration needed.

**Cache invalidation after mutations — always call `updateTag`, never `revalidatePath`.** With no tagged cache, these calls expire nothing; kept deliberately as action-response refresh trigger (Next ships refreshed tree for current route → UI updates right after mutation) and so re-adding `cacheTag` later is already wired. Keep them when touching these sites:

- Join group (OTP or magic link) → `updateTag(groupTag(slug))`
- Delete group (admin settings + super-admin), super-admin reopen group → `updateTag(groupTag(slug))`
- Account deletion (confirm Server Action, super-admin `deleteUser`) → `updateTag(groupTag(slug))` per `deleteAccount().affectedSlugs`
- Trigger draw → `updateTag(groupTag(slug))` (invite dead-end handled by `resolveToken` reading fresh, not cache invalidation — see above)
- Owner delete group (`einstellungen`) → NO `updateTag` in `deleteGroup`: action-response refresh re-renders now-404 settings route, unmounts button before client `router.push`. Nothing cached → nothing to expire (old `invalidateDeletedGroup` removed). Super-admin actions fine (server `redirect()` / `router.refresh()`).
- **Do NOT use `revalidatePath`** — all pages fully dynamic (read cookies → no static cache). `revalidatePath` no-op here, adds maintenance confusion.

`updateTag` only valid in Server Actions, not route handlers — keep mutations as actions (account-deletion confirm already is one).

**Real 404 status.** `notFound()` after streaming starts = HTTP 200 (status already fixed), `noindex` tag only. Root layout's `Nav` suspends every request (uncached session cookie read) — under `cacheComponents`, its Suspense fallback flush starts the response and fixes status 200 before ANY page-level check gets a turn, no matter where that check sits (page body, `generateMetadata` — tried both, verified both fail in a real `next build && next start`; `next dev` hides this, don't trust it for this class of bug). `generateMetadata`'s per-request data does NOT get special before-streaming treatment here: under `cacheComponents` it just joins the same deferred/streamed bucket as the rest of the page (confirmed in Next's own docs: "If other parts also defer to request time: ... metadata streams in with other deferred content").

Fix lives in **`proxy.ts` / `lib/supabase/proxy.ts`**, which runs before any React rendering, so there's no Suspense to race: `/einladung/[token]` checks `inviteTokenExists` (1 light query; page runs full `resolveToken`) and rewrites bad tokens to `/__not_found__` too; `/gruppen/[slug]` and `.../einstellungen` check group existence + membership in ONE query (group inner-joined to caller membership; unknown slug = non-member = same 404) (settings: admin role required, non-admin member = same 404 as unknown slug, no slug-existence oracle) and rewrite to `/__not_found__` (matches no route → Next's own generic 404 takes over, same as a truly unmatched URL, fully SSR'd: status 404, h1, lang, stylesheet). Invite 404 shows generic "Seite nicht gefunden" copy — invite-specific copy dropped. Do NOT rewrite to prerendered page that calls `notFound()` (e.g. old `/einladung/ungueltig`): status 404 but body = empty `__next_error__` shell, copy only in RSC payload. `NextResponse.rewrite(..., {status})` ignored — no way to set status on rewrite. **Errors ≠ not-found:** `resolveToken` throws on DB error (only no-rows → `null`); proxy lets request through on lookup error (page throws → `error.tsx`); `fetchGroupData` throws on error so failure never cached. Proxy redirects/rewrites copy `supabaseResponse` cookies (refreshed session tokens) via `withSessionCookies`. Page-level `notFound()` checks (`export const instant = false` above `<Suspense>`) stay as defense in depth, not as the actual guarantee. New dynamic-slug pages needing a real 404 must add their check in proxy, not just the page.

**Self-signup off.** `enable_signup = false` (`[auth]`, `[auth.email]`; remotes inherit; push w/ `supabase config push`). Never `signInWithOtp` with `shouldCreateUser: true`. New accounts only via `ensureAuthUser` (admin `createUser`, `lib/supabase/ensure-auth-user.ts`) after server validated invite token (`requestInviteOtp`) or super-admin email (`requestOtp`). See `docs/security.md`.

**Return-to after login.** `redirectToLogin` (proxy) appends `?next=<path>`; `lib/safe-next.ts` `safeNext()` only accepts same-origin relative paths (`/x`, not `//`, no backslash/control chars) else null → `/gruppen`. Used in `/anmelden` form (hidden field → `verifyOtp` redirect), `requestOtp` (stores `wichtelo_next` cookie, path `/auth`, since `emailRedirectTo` must match Supabase allowlist exactly → no query) and `app/auth/callback`. Always revalidate via `safeNext`, never trust hidden field.

**`/gruppen` list page fully dynamic** — reads cookies via `createClient()`, renders fresh per request. Active = `year >= currentYear || state === "open"`, rest = past. No `use cache`, no tag, no invalidation needed.

**Admin reads (`/admin/*`).** Auth users via `listAllAuthUsers` (`lib/admin/auth-users`) — throws on API error, no page cap; few users by id → `getAuthUsersById` (parallel `getUserById`, 404 → null), never list all. Table-wide selects of `profiles`/`memberships`/`groups` → `fetchAllRows` (`lib/admin/paged`, `.range()` windows; PostgREST `max_rows=1000` truncates silently). `fetchAuditLog` capped (default 200).

**Group detail page** = 1 embed query (`fetchGroupData`: group + memberships + profiles), `getUser` in parallel, `displayNames` reused by `MyAssignment` (no re-query), invite link in own `<Suspense>`.

**Assignments never cached** — fetched dynamically via user-scoped `createClient()` so RLS restricts each user to own row.

**Translations.** Server-first: call `getTranslations()` in every Server Component. Client Components that must use `'use client'` and need translations: use `createIntlContext` factory (`lib/create-intl-context.tsx`). Pattern — Server wrapper calls `getTranslations(namespace)`, passes messages to factory-produced `Provider`; client impl uses `useT()` hook from same factory. Never pass full message bundle or mount `NextIntlClientProvider` manually. All German copy in `messages/de.json`.

**No analytics, no tracking, no non-essential cookies.** No cookie banner needed. Exception: Vercel Speed Insights active — cookie-less perf telemetry, disclosed in Datenschutz, Art. 6(1)(f) basis, not covered by "no analytics" claim. Sentry error monitoring also active (EU org, no Session Replay, no cookies/storage, invite tokens scrubbed via `lib/sentry-scrub.ts`, disclosed in Datenschutz, Art. 6(1)(f)) — error telemetry only, not analytics.

## Routes (German slugs, no locale prefix)

| Route                               | Purpose                                        |
| ----------------------------------- | ---------------------------------------------- |
| `/`                                 | Landing (logged-out) or redirect to `/gruppen` |
| `/anmelden`                         | Magic link request + OTP entry                 |
| `/gruppen`                          | Groups overview                                |
| `/gruppen/neu`                      | Create group                                   |
| `/gruppen/[gruppeId]`               | Group detail                                   |
| `/gruppen/[gruppeId]/einstellungen` | Admin settings (admin-only)                    |
| `/einladung/[token]`                | Invite landing                                 |
| `/konto`                            | Account settings + deletion                    |
| `/impressum`                        | Impressum (static)                             |
| `/datenschutz`                      | Datenschutzerklärung (static)                  |

## Data model (Supabase PostgreSQL, RLS on all tables)

| Table                | Key columns                                                                                                       |
| -------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `profiles`           | `id` (→ auth.users), `first_name`, `last_name`                                                                    |
| `groups`             | `slug` (unique, auto-generated), `name`, `year`, `state` (`open`\|`drawn`), `budget_hint?`, `note?`, `created_by` |
| `memberships`        | `group_id`, `profile_id` (nullable), `name_snapshot`, `role` (`participant`\|`admin`)                             |
| `assignments`        | `group_id`, `giver_id`, `receiver_id` — overwritten entirely on re-draw                                           |
| `exclusions`         | `group_id`, `member_a`, `member_b` — bidirectional, canonical ordering enforced via check constraint              |
| `invite_tokens`      | `group_id`, `token` (unique) — logically invalidated when group state becomes `drawn`                             |
| `draw_mail_failures` | `group_id` (pk), `draw_version`, `failed`, `total` — latest draw-mail partial failure, admin-read only            |

**RLS:** User JWT = read-mostly. Participants + admins read only own assignment row (admin lookup = audited `lookupAssignment` action, service role). Memberships: own row or group admin reads. Profiles: owner only. `invite_tokens`: NO user-JWT access (policy dropped, SELECT revoked from `anon, authenticated`) — app reads via service role only. User JWT may write only: `profiles` insert/update (names), RPC `create_group`. ALL other writes (groups, memberships, assignments, exclusions, invite_tokens, profile delete) = service role only — INSERT/UPDATE/DELETE revoked from `anon, authenticated`, write policies dropped (migration `20261010120000`). New user-JWT write path → needs explicit grant + policy + RLS integration test in `lib/supabase/rls.test.ts`. `create_group` validates name 1–100, year 2000–2100, slug `^[a-z0-9-]{1,120}$`, skips reserved `neu`; `groups` CHECK constraints mirror it. Also DB-level cap: ≥5 groups by caller in last 24h → errcode `54000` (per-user advisory lock, parallel-safe); `createGroup` maps it to `rate_limited`. Backstop for direct `/rest/v1/rpc` calls bypassing Upstash limiter. Stays `authenticated`-callable (auth.uid() semantics).

**Account deletion:** drawn groups: `profile_id` on memberships set to null via RPC `ghost_drawn_memberships(profile_id)` BEFORE `deleteUser` (service-role-only; locks each drawn group row `FOR UPDATE` in id order → serializes vs `perform_draw`; FK `ON DELETE SET NULL` cascade inside `deleteUser` locks nothing); `name_snapshot` preserved, assignment rows left intact, admins notified + see "Konto gelöscht" badge in settings. Open groups: membership deleted outright BEFORE `deleteUser` via `removeMembership` (locking RPC; cascades exclusions; cleanup failure or concurrent draw aborts deletion), admins notified — deleted account never drawn. Super-admin `deleteUser` = same guards (`findSoleAdminGroups` blocks, German error lists groups) + same mails (`notifyAccountDeleted`). Confirm link = GET page + POST Server Action (`app/konto/delete/confirm`), public route (HMAC token auth), token single-use via `app_metadata.deletion_nonce`. Disclosed in Datenschutzerklärung.

**Account deletion retry-safe + fail-closed.** `deleteAccount` does ALL reads first (memberships, `app_metadata.pending_deletion`, group info, admin emails) — every read throws on `error`, nothing swallowed to `[]` (`findSoleAdminGroups`, `collectAdminEmails` too; callers map throw → `generic`). Then persists affected groups (`{groupId,state,participantName}`, no emails) to `app_metadata.pending_deletion` BEFORE first mutation; retry after partial failure (2nd open group fails, `deleteUser` fails after ghosting) merges pending + current → admin notices not lost. Deleted user takes metadata along. Self-service request (`requestAccountDeletion`): sole-admin check BEFORE rate limiter (1/24h); limiter slot refunded (`refundRateLimit`) on `email_failed`/token/notify error.

**Group creation atomic.** `createGroup` calls RPC `create_group(name, year, budget_hint, note, slugs[])` (security definer, `search_path = ''`, caller = `auth.uid()`, profile must exist) — one txn: group + admin membership + invite token. Slug `23505` retried inside RPC over candidate list; none free → raises `23505`. No service-role cleanup path.

**Draw atomic.** `triggerDraw`/`retriggerDraw` call RPC `perform_draw(group_id, pairs, expected_state, expected_version)` — one txn, row lock on group, delete+insert assignments, set `drawn`, bump `groups.draw_version`. Returns `ok|state_changed|ghost_members|membership_changed|group_not_found`. `search_path = ''` (hardened, like all other security-definer fns). `ghost_members` = open group has `profile_id` null row; `triggerDraw` pre-checks via `hasGhostMembers` (`lib/draw`), German admin error. Only `ok` caller sends emails. Trigger on `memberships` rejects insert once group `drawn`. Re-draw (`expected_state = drawn`): `retriggerDraw` draws live members only (`liveMembers`, `lib/draw`); `perform_draw` ignores ghosts in giver-set check and deletes them atomically after all early returns (return commits, so delete must come last).

**Draw-mail failures persisted.** Partial mail failure after draw/re-draw/resend → row in `draw_mail_failures` (one per group, counts only, no addresses) so resend button survives tab close / other device (no sessionStorage). Written via service-role-only RPC `record_draw_mail_result(group_id, draw_version, failed, total)` (`recordDrawMailResult`, `lib/draw-mail-status`): `failed > 0` upsert, `0` clear; never overwrites newer `draw_version` (slow resend of old draw can't clobber re-draw). Reader `fetchDrawMailWarning` uses user JWT (RLS: group admins only) and ignores row whose `draw_version` ≠ `groups.draw_version` → re-draw resets even if new send never wrote. `RedrawButton` (server) reads it, passes `warning` prop to client. Dismiss = admin action `dismissDrawMailWarning` (service-role delete). Resend keeps same idempotency key (`postDrawVersion`) → no duplicate mails. E2E seeds via `/api/test/draw-mail-failure`.

**Draw reads never swallow errors.** `triggerDraw`/`retriggerDraw` load members + exclusions via `loadDrawInputs` (`lib/draw`), `resendDrawEmails` via `loadMemberships`/`loadAssignment` — all throw on DB error, action returns `generic` + `logger.error`. Error must never become `[]`: no exclusions → draw violates constraints; no recipients → `record_draw_mail_result(0,0)` clears stored warning. Resend bails on empty members/assignments; `recordDrawMailResult` ignores `total <= 0`.

**Membership delete guarded.** `BEFORE DELETE` trigger on `memberships` rejects delete while group `drawn` (delete cascades 2 assignment rows → someone gets no gift). Passes when parent group row gone (group delete cascade) or txn-local flag `app.allow_drawn_membership_delete = on` (set only inside `remove_membership` / `perform_draw`, service-role-only security definer). All app membership deletes go through `removeMembership` (`lib/membership`) → RPC `remove_membership(group_id, membership_id, allow_drawn, enforce_last_admin)`: locks group row (`FOR UPDATE`, serializes vs draw), returns `ok|group_not_found|member_not_found|already_drawn|last_admin`. `leaveGroup` + `deleteAccount` = `allow_drawn false` (participants still cannot leave after draw). Admin `removeMember` = `allow_drawn true`: any member, also after draw; UI shows hint to press "Neu auslosen" (removed member's assignments cascade). Never `.from("memberships").delete()` in app code.

## Deep modules (pure logic, independently testable)

Extract all complex business logic into pure or near-pure modules. Do not embed in Server Actions or components.

| Module                       | Signature                                                                |
| ---------------------------- | ------------------------------------------------------------------------ |
| **Draw Engine**              | `computeDraw(members, exclusions) → assignment \| null \| TOO_COMPLEX`   |
| **Slug Generator**           | `generateSlug(name, existingSlugs) → string`                             |
| **Name Abbreviator**         | `abbreviateNames(members[]) → DisplayName[]`                             |
| **Invite Token**             | `createToken(groupId)`, `resolveToken(token) → {group,state} \| 'drawn'` |
| **Group State Machine**      | `canDraw(group, members, exclusions) → true \| ErrorReason`              |
| **Notification Dispatcher**  | `notify(event: DomainEvent) → void`                                      |
| **Account Deletion Cascade** | `deleteAccount(userId) → AffectedGroups`                                 |

## Draw algorithm

`computeDraw` must produce **derangement** (no self-assignment) with **no mutual pairs** (if A→B then B cannot→A) and all **exclusion pairs** respected (bidirectional). Two-stage: fast path = rejection sampling (Fisher-Yates + retry, 200 attempts), fallback = exhaustive randomized backtracking (MRV-ordered, prunes self/mutual/exclusion conflicts) — proves true infeasibility, not just retry exhaustion. Pre-stage: bipartite perfect-matching check (Kuhn) on allowed giver→receiver graph — no match → `null` instantly (catches household/Hall cases). Mutual-pair rule not matchable → matching = necessary condition only. Backtracking has node budget (`MAX_BACKTRACK_NODES`); exhausted → distinct `TOO_COMPLEX` (`"too_complex"`), NOT `null`. Returns `null` **iff** no valid assignment exists — draw blocked, admin sees German error. `TOO_COMPLEX` → separate German admin msg (`errors.tooComplex`, `exclusions.tooComplexWarning`) at draw, re-draw, addExclusion warning; every `computeDraw` call site must handle it. Minimum 3 participants enforced before draw triggers.

## Name display

Last names abbreviated to minimum chars needed for unique display names within Gruppe. If all first names unique, last names omitted. Admins always see full names. `abbreviateNames` handles this.

## Slug generation

Gruppe slugs auto-generated at creation from group name. Umlaut transliteration: ä→ae, ö→oe, ü→ue, ß→ss. Collisions resolved by numeric suffix (first 5 tries), then random 4-char base36 suffix (`slugCandidate`) — popular names never exhaust. Reserved slugs (`neu`, static `/gruppen/*` children; list in `lib/slug`) get `-gruppe` suffix — else static route shadows group. Add new static child → add to list. Slugs never change after creation (rename does not change slug).

## Testing

Before writing or reviewing tests, read **`docs/testing.md`** — covers unit/integration/E2E conventions, mandatory E2E rule (every new flow ships with spec), and E2E patterns.

## Working on a GitHub issue or opening a PR

**Mandatory order — no exceptions:**

1. Read **`docs/pr-workflow.md`** first (checklist + full workflow). Do this before touching any code.
2. Create branch (`feat/issue-N-short-description` or `fix/issue-N-short-description`) before writing code.
3. Implement.
4. Run pre-PR checklist (`pnpm typecheck`, `pnpm format`, `pnpm lint`, `pnpm test`), fix all failures.
5. Commit, push, open PR with `Closes #N` in body.

## Out of scope

Open registration, wishlists, draw scheduling, back-office panel, multi-language support, analytics, gift budget enforcement, multiple draws per group per year, decline-invite flow, cold invite emails.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
