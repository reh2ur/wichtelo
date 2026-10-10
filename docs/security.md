# Security + hardening decisions

## Bots + link previews

`proxy.ts` returns 403 to all bots (except `/robots.txt`). Side effect: WhatsApp/Slack/facebookexternalhit get 403 → shared invite links show no preview. **Deliberate.** Invite token = bearer credential; preview fetchers would hit + cache + log token URLs on third-party servers. Do not allowlist preview bots without new decision.

**Decision (#198, #243): keep 403, no allowlist.** Preview bot must GET full invite URL → token leaves our server to WhatsApp/Slack/Meta infra, cached + logged there. Allowlisting UA no help: UA spoofable, token exposure inherent to fetch. Serving generic OG card at `/einladung/*` same problem — fetch itself leaks token. No safe way w/o putting token out of URL (breaks link-sharing UX). Cost accepted: invite link shows bare URL in chat apps. Revisit only if invite scheme changes (e.g. token in fragment, which bots never send).

Private paths (`/gruppen/*`, `/einladung/*`) also send `X-Robots-Tag: noindex, nofollow` (`next.config.ts`) as backup to `robots.txt` + proxy block.

## Headers

- `poweredByHeader: false` → no `X-Powered-By`.
- Auth OTP lifetime 900s (15 min) in `supabase/config.toml`; mail templates say "15 Minuten". Change one → change other, `supabase config push`.

## Auth hardening (issue #15, #23, #24)

- App = OTP/magic-link only. GoTrue password endpoints still reachable w/ publishable key → migration `20261010100000` trigger `blank_auth_password` on `auth.users` wipes any written password (can't reject: GoTrue gives OTP-created users random temp password). Password login impossible whoever picked password. Integration tests sign in via OTP (`lib/supabase/test-sign-in.ts`), never password.
- `enable_confirmations = true` (base + remotes) → password signup yields no session. `max_frequency = "60s"` per address. No captcha yet (needs Turnstile account).
- Super-admin = `isSuperAdminEmail` (`lib/admin/super-admin-email.ts`), case-insensitive; used in `proxy.ts`, `isSuperAdmin()`, `/anmelden`. `app/admin/layout.tsx` also guards (`notFound()`) — proxy matcher skips `.png/.svg` paths. Sign in once as super-admin before go-live.
- Emailed button → `{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=email` (both templates), NOT `{{ .ConfirmationURL }}`. Targets `/auth/callback` + `/einladung/[token]/magiclink` = GET confirm page only; POST Server Action → `verifyEmailLink` (`lib/auth/email-link.ts`, `verifyOtp({token_hash,type:"email"})`). Scanner prefetch can't burn token, works cross-device, no PKCE verifier. Failure → `?error=link_invalid|rate_limited` + German message. Redirect allow-list `/**` wildcards cover both routes.
- Rate limits (Upstash, required in prod via `lib/env.ts`): OTP request = per email + per-IP backstop; OTP verify = per email 10/15 min + per-IP 30/15 min; link confirm = per-IP. IP key = `x-vercel-forwarded-for`, IPv6 collapsed to /64 (`normalizeIpKey`).
- Supabase 429 / `over_*_rate_limit` → `rate_limited` (`lib/supabase/auth-errors.ts`). `/anmelden` masks per-address email throttle as `otp_sent` (else existing accounts leak on 2nd quick request); logged as `auth.sign_in_otp_failed`.
- Hosted Supabase per-IP auth limits (`sign_in_sign_ups`, `token_verifications`, 5 min window) count Vercel egress IPs, not users → raised to 300 in `[remotes.*.auth.rate_limit]`. Plan caps may apply; check dashboard after `supabase config push`. `email_sent` sized for peak (100/h now).

## Observability

- `instrumentation.ts` `onRequestError` → structured pino error (`request.unhandled_error`): serialized error, method, `routePath`, `routeType`. No request path/headers (invite token in path, cookies in headers).
- Console patch (prod only) forwards to pino only — no double log.
- Log errors via `serializeError(err)` (`lib/serialize-error.ts`), never `String(err)` (`[object Object]`).
- `GET /api/health` → 200 `{status:"ok"}` / 503. DB ping w/ publishable key, no secrets. Bot UA allowed in `proxy.ts`. Point external uptime monitor (e.g. UptimeRobot, free) at it — ops step, not in repo.
- No third-party error tracker yet: needs vendor choice (EU-hosted), Datenschutz disclosure. Logs → Vercel only; watch them or add log drain.

## Identifier guard

CI job `pii-guard` (`scripts/check-no-pii.mts`, local: `pnpm check:pii`) scans all tracked files, fails w/ `file:line` + rule name (never matched text — logs may be public).

- Generic rules committed in `scripts/pii-scan.mts`: secret shapes (Resend, Stripe-style, Supabase token, Sentry token/DSN, JWT, private key), concrete `*-projects.vercel.app` team slug.
- Private terms (real name, address, old slugs/domains) NEVER committed. Source: repo variable `PII_DENYLIST` (Settings → Secrets and variables → Actions → Variables; one term per line, `#` comments) and/or gitignored `.pii-denylist` locally. Case-insensitive literal match. Unset → only generic rules run (notice in log). Fork PRs get no repo variables → generic only.
- Extend: add generic regex to `genericRules` + case in `scripts/pii-scan.test.ts`; add private term to variable. Scanner files + `pnpm-lock.yaml` excluded.
