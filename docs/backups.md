# Backups + restore

## Keep-alive

`.github/workflows/supabase-keep-alive.yml` calls RPC `keep_alive()` (`POST /rest/v1/rpc/keep_alive`, `select 1`, migration `20261110120000`) daily w/ **publishable** key. Old ping = `groups` table read (RLS → 0 rows): HTTP 200 but staging still got pause-warning mail, so not counted as activity. Migration must be pushed to staging + prod (`supabase db push`) else RPC 404 → workflow red (`sb_publishable_…`, sent as `apikey` header only). Not PostgREST root `/rest/v1/`: 401 w/ publishable key. Repo **secrets**, never vars (vars print unmasked in job logs): `SUPABASE_URL_{STAGING,PROD}`, `SUPABASE_PUBLISHABLE_KEY_{STAGING,PROD}`. No service-role key in CI: do not create `SUPABASE_SERVICE_ROLE_KEY_*` repo secrets. Rotate prod service-role key if ever shown in logs.

## Backup strategy (prod)

Free tier = no PITR, limited backups. Losing assignments mid-December = costly. Pick one:

1. **Upgrade to Pro** — daily backups, PITR add-on. Preferred before draw season (Nov-Dec).
2. **Manual/scheduled dump** — `supabase db dump --linked -f backup.sql` (schema) + `supabase db dump --linked --data-only -f data.sql`. Needs `supabase link` + DB password. Encrypt before store: `age -r <pubkey> data.sql > data.sql.age`. Store off-GitHub (private bucket / password manager vault). Retention: 14 daily, 8 weekly. Dump contains personal data (emails, names) — treat as sensitive, delete per retention.

Dump workflow in CI not added: needs DB password + age key secrets + storage target = owner decision.

## Restore procedure

Test quarterly + before draw season, against **staging**, never prod first.

1. `age -d -i key.txt data.sql.age > data.sql`
2. New/empty project (or `supabase db reset --linked` on staging).
3. Apply schema: `supabase db push` (migrations) — or schema dump.
4. `psql "$DB_URL" -f data.sql`
5. Verify: row counts for `groups`, `memberships`, `assignments`; log in as test user, open drawn group.
6. Prod incident: restore into fresh project, repoint `NEXT_PUBLIC_SUPABASE_*` env in Vercel, update auth redirect config via `supabase config push`.
