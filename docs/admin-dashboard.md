# Admin Back-Office — PRD

Back-office dashboard at `/admin` for platform operator (super-admin = account configured via `SUPER_ADMIN_EMAIL`). Read views all users + groups, write actions with full audit trail, protected by middleware — 404 to non-admins.

## Design decisions

| Decision             | Choice                                                    | Reason                                              |
| -------------------- | --------------------------------------------------------- | --------------------------------------------------- |
| Super-admin identity | `SUPER_ADMIN_EMAIL` env var                               | Zero DB changes, revocable, single admin            |
| Registration bypass  | Same env var exempts email from `shouldCreateUser: false` | Admin self-register on fresh deploy                 |
| Route location       | `/admin` route group, same Next.js app                    | One deploy, shared auth session                     |
| IP restriction       | None — app-level 404 only                                 | No stable IP; magic link proves identity            |
| UI library           | Tanstack Table + existing shadcn/ui                       | Fits stack, free sorting/filtering/pagination       |
| Ban mechanism        | Supabase native ban (`ban_duration`)                      | Reversible, invalidates sessions, no extra columns  |
| Audit log storage    | `admin_audit_log` Supabase table                          | Console logs expire; DB persists + queryable        |
| Datenschutz          | Update `/datenschutz` in same epic                        | GDPR Art. 13 requires disclosure of operator access |

## Architecture

- All `/admin/**` routes: Server Components, `createAdminClient()` (service role key, bypasses RLS).
- `proxy.ts` guard: for `/admin` paths, check `user.email === process.env.SUPER_ADMIN_EMAIL` → 404 on mismatch/unauthenticated. Runs before `updateSession`.
- `@tanstack/react-table` for all data tables (not yet installed — pulled in when #53/#54 build tables).
- `lib/admin/audit.ts` deep module: `logAdminAction(action, targetType, targetId, metadata?)`. Actor always `process.env.SUPER_ADMIN_EMAIL` — single-admin system, no actor param needed.

## Data model

`admin_audit_log` table (migration `20260802000000_admin_audit_log.sql`), no RLS — service-role only:

| Column        | Type        | Notes                                                                           |
| ------------- | ----------- | ------------------------------------------------------------------------------- |
| `id`          | uuid pk     | `gen_random_uuid()`                                                             |
| `actor_email` | text        | always `SUPER_ADMIN_EMAIL`                                                      |
| `action`      | text        | `ban_user` \| `unban_user` \| `delete_user` \| `delete_group` \| `reopen_group` |
| `target_type` | text        | `user` \| `group`                                                               |
| `target_id`   | text        | user id or group id                                                             |
| `metadata`    | jsonb       | action-specific extra context                                                   |
| `created_at`  | timestamptz | default `now()`                                                                 |

## Routes

| Route                       | Purpose                                 | Ships in |
| --------------------------- | --------------------------------------- | -------- |
| `/admin`                    | Overview: counts + recent audit entries | #55      |
| `/admin/benutzer`           | Users table                             | #53      |
| `/admin/benutzer/[userId]`  | User detail + actions                   | #53      |
| `/admin/gruppen`            | Groups table                            | #54      |
| `/admin/gruppen/[gruppeId]` | Group detail + actions                  | #54      |
| `/admin/audit-log`          | Full paginated audit log                | #55      |

## Sub-issues (implement in order)

- [x] #52 — Foundation: middleware guard, env var, DB migration, audit module, registration bypass
- [x] #53 — Users section: `/admin/benutzer` table + detail + ban/unban/delete actions
- [x] #54 — Groups section: `/admin/gruppen` table + detail + delete/reopen actions
- [x] #55 — Overview dashboard + audit log pages
- [ ] #56 — Datenschutz: operator data access disclosure (GDPR Art. 13)

## Out of scope

Multi-admin support, per-action permission granularity, impersonation, data export/download, email from dashboard, audit log retention/auto-purge.
