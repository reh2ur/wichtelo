# Go-live checklist

Tick each before public launch / before draw season. Env var names in `.env.example`. Prod env validated at build (`VERCEL_ENV=production`, `lib/env.ts`) + boot (`instrumentation.ts`) — missing var fails build.

## Supabase (live project)

- [ ] `supabase link` → live. Refs in `supabase/.env.local` + literal `project_id` in `config.toml [remotes.*]` match.
- [ ] `pnpm db:push:live` — all migrations. Run BEFORE merging code that needs them (Vercel deploys `main` at once → new code on old schema breaks RPCs like `perform_draw`/`create_group`). Keep migrations backward-compatible w/ previous deploy.
- [ ] `pnpm db:config:push:live` — templates, redirect allow-list, SMTP, `email_sent = 100`. Needs `LIVE_SITE_URL`, `LIVE_REDIRECT_URL` (`https://<domain>/**`), `AUTH_SMTP_ADMIN_EMAIL`, `RESEND_API_KEY`.
- [ ] Staging: same with `:staging` scripts + `STAGING_PREVIEW_REDIRECT_URL` wildcard (`https://<project>-*-<team>-projects.vercel.app/**`).
- [ ] Verify magic link + OTP mail arrive on live; link lands on `/auth/callback`.
- [ ] Region Frankfurt (EU).

## Mail (Resend)

- [ ] Domain verified: SPF, DKIM, DMARC (start `p=none`, tighten later).
- [ ] `RESEND_FROM_EMAIL` + `AUTH_SMTP_ADMIN_EMAIL` on verified domain.
- [ ] Quotas sized for December: Resend free = 3,000/month AND 100/day, shared app mail + Supabase Auth SMTP. Draw mails burst (one per member). Supabase `email_sent` = 100/h. Upgrade plan if peak exceeds.
- [ ] Reply-To deliberately unset (see CLAUDE.md).

## Vercel

- [ ] Function region `fra1` (project settings → Functions, or `vercel.json` `"regions": ["fra1"]`). Default `iad1` = transatlantic hop per Supabase query.
- [ ] Env (production): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `NEXT_PUBLIC_SITE_URL`, `OPERATOR_NAME`, `OPERATOR_ADDRESS_LINE1`, `OPERATOR_ADDRESS_LINE2`, `OPERATOR_CONTACT_EMAIL`, `ACCOUNT_DELETION_SECRET` (>= 32 chars, not service-role key), `SUPER_ADMIN_EMAIL`, `SUPABASE_PROJECT_REF_LIVE` (E2E backdoors refuse live project).
- [ ] Deployment Protection on for previews; `VERCEL_AUTOMATION_BYPASS_SECRET` + `E2E_TEST_SECRET` in GitHub secrets.
- [ ] Impressum + Datenschutz render real operator data (`/impressum`).

## Upstash (required)

- [ ] Redis DB (EU region). `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` in production env. Unset = rate limiting OFF (allows all) — not enforced by env check, set it.

## Sentry (EU)

- [ ] EU-region project. `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_ORG`, `SENTRY_PROJECT` (+ auth token for source maps).
- [ ] Datenschutz names Sentry as processor BEFORE DSN set in prod.

## Super-admin

- [ ] `SUPER_ADMIN_EMAIL` set. Register that account immediately after first deploy (email can create account on fresh deployment; only it gets `/admin`).
- [ ] Audit log writes best-effort, after action — check `admin_audit_log` rows after first admin action.

## Uptime, backups, keep-alive

- [ ] External uptime monitor on `GET /api/health` (real DB ping), alert to owner.
- [ ] Backup route chosen + restore tested (`docs/backups.md`). Pro plan preferred before Nov.
- [ ] Keep-alive: run `supabase-keep-alive` via `workflow_dispatch` once, confirm green both envs. Repo vars `SUPABASE_URL_*`, `SUPABASE_PUBLISHABLE_KEY_*` set. GitHub disables schedules after 60 days repo inactivity; free project pauses after 7 days idle. Prefer ping `/api/health` over `/rest/v1/` (follow-up).

## CI / supply chain

- [ ] CI green incl. `db-lint` job (migrations + integration tests).
- [ ] `pnpm audit --prod` clean except upstream `sprintf-js` advisory (no patched release yet; dev/pretty-terminal logger only). Recheck, add override `>=1.1.4` once published.
- [ ] Node 22 on Vercel (`engines`).

## Final smoke (prod)

- [ ] Sign up, create group, invite second account, join, draw (3+ members), draw mail arrives, CTA link works.
- [ ] Delete test group + account.
