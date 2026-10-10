# Security + hardening decisions

## Bots + link previews

`proxy.ts` returns 403 to all bots (except `/robots.txt`). Side effect: WhatsApp/Slack/facebookexternalhit get 403 → shared invite links show no preview. **Deliberate.** Invite token = bearer credential; preview fetchers would hit + cache + log token URLs on third-party servers. Do not allowlist preview bots without new decision.

**Decision (#198, #243): keep 403, no allowlist.** Preview bot must GET full invite URL → token leaves our server to WhatsApp/Slack/Meta infra, cached + logged there. Allowlisting UA no help: UA spoofable, token exposure inherent to fetch. Serving generic OG card at `/einladung/*` same problem — fetch itself leaks token. No safe way w/o putting token out of URL (breaks link-sharing UX). Cost accepted: invite link shows bare URL in chat apps. Revisit only if invite scheme changes (e.g. token in fragment, which bots never send).

Private paths (`/gruppen/*`, `/einladung/*`) also send `X-Robots-Tag: noindex, nofollow` (`next.config.ts`) as backup to `robots.txt` + proxy block.

## Headers

- `poweredByHeader: false` → no `X-Powered-By`.
- Auth OTP lifetime 900s (15 min) in `supabase/config.toml`; mail templates say "15 Minuten". Change one → change other, `supabase config push`.

## Observability

- `instrumentation.ts` `onRequestError` → structured pino error (`request.unhandled_error`): serialized error, method, `routePath`, `routeType`. No request path/headers (invite token in path, cookies in headers).
- Console patch (prod only) forwards to pino only — no double log.
- Log errors via `serializeError(err)` (`lib/serialize-error.ts`), never `String(err)` (`[object Object]`).
- `GET /api/health` → 200 `{status:"ok"}` / 503. DB ping w/ publishable key, no secrets. Bot UA allowed in `proxy.ts`. Point external uptime monitor (e.g. UptimeRobot, free) at it — ops step, not in repo.
- Sentry wired (`sentry.{server,edge}.config.ts`, `instrumentation-client.ts`, tunnel `/monitoring`). Unset `NEXT_PUBLIC_SENTRY_DSN` = disabled. User info, bodies, IP-ish headers/cookies scrubbed. Use EU region project. Datenschutz disclosure must name Sentry before DSN set in prod (see `docs/go-live.md`). Logs also → Vercel.

## Identifier guard

CI job `pii-guard` (`scripts/check-no-pii.mts`, local: `pnpm check:pii`) scans all tracked files, fails w/ `file:line` + rule name (never matched text — logs may be public).

- Generic rules committed in `scripts/pii-scan.mts`: secret shapes (Resend, Stripe-style, Supabase token, Sentry token/DSN, JWT, private key), concrete `*-projects.vercel.app` team slug.
- Private terms (real name, address, old slugs/domains) NEVER committed. Source: repo variable `PII_DENYLIST` (Settings → Secrets and variables → Actions → Variables; one term per line, `#` comments) and/or gitignored `.pii-denylist` locally. Case-insensitive literal match. Unset → only generic rules run (notice in log). Fork PRs get no repo variables → generic only.
- Extend: add generic regex to `genericRules` + case in `scripts/pii-scan.test.ts`; add private term to variable. Scanner files + `pnpm-lock.yaml` excluded.
