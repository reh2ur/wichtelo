# Supabase local dev flow

## Starting up

```bash
pnpm db:start   # start local DB + auth + Studio
pnpm dev        # start Next.js
```

Stop when done:

```bash
pnpm db:stop
```

Local Studio runs at **http://127.0.0.1:54323** — use it to browse tables, run SQL, and inspect auth users.

---

## Getting data locally

The local DB starts empty (schema only). Populate it via:

- **Studio** — table editor and SQL runner at http://127.0.0.1:54323
- **`supabase/seed.sql`** — add `INSERT` statements for fixtures you always want on a fresh start; applied automatically on `db:start` and `db:reset`
- **`pnpm db:reset`** — wipes the local DB and replays all migrations + seed from scratch; use this for a clean slate

---

## Writing and testing a migration

1. Create a new migration file:
   ```bash
   pnpm db:migration add_wishlists
   # creates supabase/migrations/<timestamp>_add_wishlists.sql
   ```
2. Write your SQL in that file
3. Apply it locally:
   ```bash
   pnpm db:reset   # clean replay of all migrations + seed
   ```
4. Verify there is no drift:
   ```bash
   pnpm db:diff    # should print "No schema changes found"
   ```
5. Commit the migration file together with your feature code in the same PR

---

## PRs and preview deployments

|                | Where                                                                  |
| -------------- | ---------------------------------------------------------------------- |
| **Code**       | Vercel auto-deploys a preview for every PR                             |
| **Database**   | Preview deployments hit **staging** Supabase project (not prod)        |
| **Migrations** | Applied to production only on merge to `main` (via GitHub integration) |

During a PR, preview app runs against staging data, never prod. Staging = test-only: no real user emails, no real person as staging `SUPER_ADMIN_EMAIL`. Keep Vercel Deployment Protection on. If PR adds new column/table, push migration to staging first (`supabase db push` linked to staging) or preview fails. This is acceptable for solo development — Supabase's paid branching feature provides per-PR database previews if this becomes a problem.

---

## Local auth mail + redirects

- Local stack: `[auth.email.smtp]` `enabled = false` → OTP/magic-link mail lands in Mailpit, http://127.0.0.1:54324. Never real Resend, no `email_sent` quota use.
- Local `site_url` = `https://localhost:3000` (matches `pnpm dev`), `additional_redirect_urls` allow any localhost/127.0.0.1 port → magic links sign in, worktree ports OK.
- Hosted: Resend SMTP enabled only in `[remotes.live.auth.email.smtp]` + `[remotes.staging.auth.email.smtp]`. Need `RESEND_API_KEY` env when running `supabase config push`. Add new hosted project → add own `[remotes.*]` block w/ site_url, redirects, smtp, else push overwrites w/ local values.
- Hosted `email_sent` = 100/h, set only in `[remotes.live.auth.rate_limit]` + `[remotes.staging.auth.rate_limit]`. Local `[auth.rate_limit]` stays 2 (Mailpit, no SMTP). Limit applies only after `supabase config push`; needs custom SMTP enabled (Resend), else ignored.

---

## E2E backdoors on preview

Preview env (Vercel) needs `E2E_TEST_MODE=1` + `E2E_TEST_SECRET`; same secret in GitHub secret `E2E_TEST_SECRET`. Never in Production env. Keep Deployment Protection on. Details: `docs/testing.md`.

---

## The one rule

> **Never edit a migration file that has already been merged to `main`.** Always create a new migration file instead. The local DB is trivial to reset; the production DB is not.

---

## Script reference

| Script                     | What it does                                           |
| -------------------------- | ------------------------------------------------------ |
| `pnpm db:start`            | Start local Supabase stack                             |
| `pnpm db:stop`             | Stop local Supabase stack                              |
| `pnpm db:reset`            | Wipe local DB and replay all migrations + seed         |
| `pnpm db:diff`             | Show schema drift between local DB and migration files |
| `pnpm db:push`             | Push pending migrations to the remote (production) DB  |
| `pnpm db:push:staging`     | Push pending migrations to staging project             |
| `pnpm db:push:live`        | Push pending migrations to live project                |
| `pnpm db:migration <name>` | Create a new timestamped migration file                |

`db:push:*` + `db:config:push:*` read project refs from `SUPABASE_PROJECT_REF_LIVE` / `_STAGING` in `supabase/.env.local` (gitignored) via `scripts/supabase-remote.mjs`. `config.toml` `[remotes.*] project_id` stays literal (CLI cannot resolve `env()` there; wrong match pushes base localhost config).
