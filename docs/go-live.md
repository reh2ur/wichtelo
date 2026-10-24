# Go-live checklist

Tick each before public launch / before draw season. Env var names in `.env.example`. Prod env validated at build (`VERCEL_ENV=production`, `lib/env.ts`) + boot (`instrumentation.ts`) — missing var fails build.

## Supabase (live project)

- [ ] `supabase link` → live. Refs in `supabase/.env.local` + literal `project_id` in `config.toml [remotes.*]` match.
- [ ] `pnpm db:push:live` — all migrations. Run BEFORE merging code that needs them (Vercel deploys `main` at once → new code on old schema breaks RPCs like `perform_draw`/`create_group`). Keep migrations backward-compatible w/ previous deploy.
- [ ] `pnpm db:config:push:live` — templates, redirect allow-list, SMTP, `email_sent = 100`. Needs `LIVE_SITE_URL`, `LIVE_REDIRECT_URL` (`https://<domain>/**`), `AUTH_SMTP_ADMIN_EMAIL`, `RESEND_API_KEY`.
- [ ] Staging: same with `:staging` scripts + `STAGING_PREVIEW_REDIRECT_URL` wildcard (`https://<project>-*-<team>-projects.vercel.app/**`).
- [ ] Verify magic link + OTP mail arrive on live; link lands on `/auth/callback`.
- [ ] Region Frankfurt (EU).
- [ ] Self-signup off (#130): `config.toml` `[auth] enable_signup = false` + `[auth.email] enable_signup = false` (remotes inherit) → pushed w/ `db:config:push:live` AND `:staging`. Verify per project: dashboard Auth → Sign In / Providers → "Allow new users to sign up" OFF, email provider signups off. Check: `curl -X POST $URL/auth/v1/otp -H "apikey: $PUBLISHABLE" -d '{"email":"x@example.com","create_user":true}'` → 422 `otp_disabled` / `signup_disabled`, no user created. Push config BEFORE/with code merge: old code relied on signup for new invitees → new code creates users server-side (`ensureAuthUser`), so deploy code first or together; config alone breaks invite join on old code.

## Mail (Resend)

- [ ] Domain verified: SPF, DKIM, DMARC (start `p=none`, tighten later).
- [ ] `RESEND_FROM_EMAIL` + `AUTH_SMTP_ADMIN_EMAIL` on verified domain.
- [ ] Quotas sized for December: Resend free = 3,000/month AND 100/day, shared app mail + Supabase Auth SMTP. Draw mails burst (one per member). Supabase `email_sent` = 100/h. Upgrade plan if peak exceeds.
- [ ] Reply-To deliberately unset (see CLAUDE.md).

## Vercel

- [x] Function region `fra1` — set in `vercel.json` `"regions": ["fra1"]`. Default `iad1` = transatlantic hop per Supabase query. Verify after first deploy: project settings → Functions shows Frankfurt.
- [ ] Env (production): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `NEXT_PUBLIC_SITE_URL`, `OPERATOR_NAME`, `OPERATOR_ADDRESS_LINE1`, `OPERATOR_ADDRESS_LINE2`, `OPERATOR_CONTACT_EMAIL`, `ACCOUNT_DELETION_SECRET` (>= 32 chars, not service-role key), `SUPER_ADMIN_EMAIL`, `SUPABASE_PROJECT_REF_LIVE` (E2E backdoors refuse live project).
- [ ] Deployment Protection on for previews; `VERCEL_AUTOMATION_BYPASS_SECRET` + `E2E_TEST_SECRET` in GitHub secrets.
- [ ] Impressum + Datenschutz render real operator data (`/impressum`).

## Upstash (required)

- [ ] Redis DB (EU region). `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` in production env. Enforced by prod env check (build + boot) — missing = build fails.

## Sentry (EU)

- [ ] EU-region project. `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_ORG`, `SENTRY_PROJECT` (+ auth token for source maps).
- [ ] Datenschutz already lists Sentry (see `docs/security.md`); re-check wording matches final org/region before DSN set in prod.

## Super-admin

- [ ] `SUPER_ADMIN_EMAIL` set. Sign in with that account immediately after first deploy (`requestOtp` creates it server-side via `ensureAuthUser`, signup is off; only it gets `/admin`).
- [x] Audit log writes best-effort, after action. `logAdminAction` never throws; insert failure logs `admin.audit_log_failed` (error level) → action succeeds, row missing. Check `admin_audit_log` rows after first admin action; grep prod logs for that key.

## Uptime, backups, keep-alive

- [ ] External uptime monitor on `GET /api/health` (real DB ping), alert to owner.
- [ ] Backup route chosen + restore tested (`docs/backups.md`). Pro plan preferred before Nov.
- [ ] Keep-alive: run `supabase-keep-alive` via `workflow_dispatch` once, confirm green both envs. Repo secrets `SUPABASE_URL_*`, `SUPABASE_PUBLISHABLE_KEY_*` set. GitHub disables schedules after 60 days repo inactivity; free project pauses after 7 days idle. Keep-alive reads `groups` table, not `/rest/v1/` root (401 w/ publishable key).

## CI / supply chain

- [ ] CI green incl. `db-lint` job (migrations + integration tests).
- [ ] `pnpm audit --prod` clean (recheck before launch). Full `pnpm audit`: dev-tooling advisories patched via `pnpm-workspace.yaml` overrides. Left: `zod@3` under `shadcn` CLI (no v3 patch, cross-major override risky, dev-only). `vite` = direct devDep so vitest peer resolves patched release (override on peer-only dep does not re-resolve lock).
- [ ] Node 22 on Vercel (`engines`).

## Final smoke (prod)

- [ ] Sign up, create group, invite second account, join, draw (3+ members), draw mail arrives, CTA link works.
- [ ] Delete test group + account.
