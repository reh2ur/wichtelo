# Wichtelo — Secret Santa web app

A German-language web app for Secret Santa ("Wichteln") gift exchanges. A group admin creates a group, shares an invite link, defines exclusions (e.g. partners), and triggers a fair random draw. Everyone is notified by email and can look up who they are giving to. Passwordless (magic link / one-time code), invite-only, mobile-first, built for GDPR-conscious operation in Germany.

Full product context and user stories: [`docs/prd.md`](docs/prd.md).

## Stack

- [Next.js 16](https://nextjs.org) (App Router, React 19, React Compiler, Turbopack), TypeScript, pnpm
- [Supabase](https://supabase.com): PostgreSQL with row-level security, Auth (magic link + OTP)
- [Resend](https://resend.com) + React Email for transactional mail
- Tailwind CSS, shadcn/ui on Base UI, next-intl (German only)
- Vitest (unit/integration) and Playwright (E2E)
- Optional: Upstash Redis for rate limiting, Vercel for hosting

## Local development

Requirements: Node 22, [pnpm](https://pnpm.io), [Supabase CLI](https://supabase.com/docs/guides/local-development) and Docker.

```bash
pnpm install
cp .env.example .env.local      # then fill in values (see below)
pnpm db:start                   # local Supabase: DB, auth, Studio, Mailpit
pnpm dev                        # https://localhost:3000 (experimental HTTPS)
```

- Local Studio: http://127.0.0.1:54323. Local auth mail (magic links, codes) lands in Mailpit at http://127.0.0.1:54324, no real email is sent.
- `supabase start` prints the local API URL and keys for `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` and `SUPABASE_SERVICE_ROLE_KEY`.
- Contributors using git worktrees can use `wt dev` for a per-worktree port.
- More on migrations and local/hosted Supabase: [`docs/supabase-dev-flow.md`](docs/supabase-dev-flow.md).

Checks before opening a PR (see [`docs/pr-workflow.md`](docs/pr-workflow.md)):

```bash
pnpm typecheck && pnpm format && pnpm lint && pnpm test
pnpm e2e:dev                    # Playwright against the local dev server
```

Conventions and architecture notes live in [`CLAUDE.md`](CLAUDE.md), [`docs/testing.md`](docs/testing.md) and [`docs/security.md`](docs/security.md).

## Deploying your own instance

No code edits are needed: everything instance-specific is configured through environment variables. The reference below expands on [`.env.example`](.env.example).

### 1. Supabase

1. Create a Supabase project (pick an EU region for GDPR) and run `supabase link --project-ref <ref>`.
2. Apply the schema: `supabase db push`.
3. Copy URL, publishable key and service-role key from Project Settings → API into the env vars below.
4. Auth settings are managed by [`supabase/config.toml`](supabase/config.toml). Add a `[remotes.<name>]` block for your project (`project_id` must be a literal ref) and push with `supabase config push --project-ref <ref>`. The block reads these values via `env()`; put them in `supabase/.env.local`:
   - `LIVE_SITE_URL`, `LIVE_REDIRECT_URL` (`https://<domain>/**`)
   - `STAGING_PREVIEW_REDIRECT_URL` (only if you run a preview/staging project)
   - `AUTH_SMTP_ADMIN_EMAIL` (sender address for auth mail)
   - `RESEND_API_KEY` (used as SMTP password)
5. Auth mail templates are in `supabase/templates/`. They are pushed with `supabase config push`, not by the app.

### 2. Resend

Create an API key and verify your sending domain at resend.com. Supabase Auth mail (codes, magic links) goes through Resend SMTP; app mail (draw results, notices) goes through the Resend API.

### 3. Environment variables

| Variable                                                                                      | Required                | Purpose                                                     |
| --------------------------------------------------------------------------------------------- | ----------------------- | ----------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`                                                                    | always                  | Supabase project URL                                        |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`                                                        | always                  | Supabase publishable key                                    |
| `SUPABASE_SERVICE_ROLE_KEY`                                                                   | always                  | Server-only admin key, never expose                         |
| `NEXT_PUBLIC_SITE_URL`                                                                        | production              | Canonical origin used for links in email                    |
| `RESEND_API_KEY`, `RESEND_FROM_EMAIL`                                                         | production              | Transactional email                                         |
| `ACCOUNT_DELETION_SECRET`                                                                     | production              | HMAC secret for deletion links, at least 32 chars           |
| `OPERATOR_NAME`, `OPERATOR_ADDRESS_LINE1`, `OPERATOR_ADDRESS_LINE2`, `OPERATOR_CONTACT_EMAIL` | production              | Legally required Impressum (§ 5 DDG), shown on `/impressum` |
| `SUPER_ADMIN_EMAIL`                                                                           | optional                | Account allowed into the `/admin` back-office               |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`                                          | optional                | Rate limiting; all requests allowed when unset              |
| `SUPABASE_PROJECT_REF_LIVE`                                                                   | recommended on previews | E2E backdoors refuse to run against this project            |
| `E2E_TEST_MODE`, `E2E_TEST_SECRET`                                                            | previews/local E2E only | Enables test-only endpoints. **Never set in production**    |

In production the app validates required variables at boot and fails with a list of what is missing. Previews and local dev are more lenient (placeholders for the Impressum, dry-run mail).

### 4. Hosting

Any Node host works; the project is developed against Vercel. On Vercel: import the repo, set the variables above for Production (and Preview, pointing at a separate staging Supabase project), and add your domain. Keep Deployment Protection on for previews.

Optional, add to your instance's Supabase dashboard: Auth → Email → turn **off** "Confirm email" so new users can sign in directly via OTP/magic link.

### Parts specific to the original deployment

Be aware before forking:

- **Branding and copy:** the name "Wichtelo", the logo/brand assets in `public/brand/` and all German copy in `messages/de.json` are the original deployment's. Change them to taste.
- **Legal texts:** `/datenschutz` (privacy policy) describes the original processors (Supabase EU, Resend, Vercel incl. Speed Insights, optional Upstash). Review and adapt it to your setup and jurisdiction. The Impressum content comes from the `OPERATOR_*` variables.
- **Vercel Speed Insights** is enabled in the app and disclosed in the privacy policy. Remove it if you do not use Vercel.
- The app is German-only (next-intl without locale prefix).

## Contributing and issues

Open an issue before larger changes. PRs follow [`docs/pr-workflow.md`](docs/pr-workflow.md).

## License

[GNU AGPL-3.0](LICENSE). If you run a modified version as a public service, section 13 requires you to offer its users the corresponding source code (for example a link to your fork).
