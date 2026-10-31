# Backups + restore

## Keep-alive

`.github/workflows/supabase-keep-alive.yml` reads `groups` table (`/rest/v1/groups?select=id&limit=1`, RLS → 0 rows) daily w/ **publishable** key (`sb_publishable_…`, sent as `apikey` header only). Not PostgREST root `/rest/v1/`: 401 w/ publishable key. Repo **secrets**, never vars (vars print unmasked in job logs): `SUPABASE_URL_{STAGING,PROD}`, `SUPABASE_PUBLISHABLE_KEY_{STAGING,PROD}`. No service-role key in CI: do not create `SUPABASE_SERVICE_ROLE_KEY_*` repo secrets. Rotate prod service-role key if ever shown in logs (Supabase dashboard → API keys; then update Vercel `SUPABASE_SERVICE_ROLE_KEY`, redeploy). Backup workflow uses DB URL secret, not service-role key.

## Backup strategy (prod)

Free tier = no PITR, limited backups. Losing assignments mid-December = costly. Pick one:

1. **Upgrade to Pro** — daily backups, PITR add-on. Preferred before draw season (Nov-Dec).
2. **Scheduled dump** — implemented, see below. Retention: 14 daily, 8 weekly. Dump contains personal data (emails, names) — treat as sensitive.

### Scheduled dump (`.github/workflows/db-backup.yml`)

Daily 02:43 UTC + `workflow_dispatch`. `pg_dump -Fc` (schemas `public` + `auth`, no owner/privileges) of prod → `age -r $BACKUP_AGE_PUBLIC_KEY` → S3-compatible EU bucket via `aws s3 --endpoint-url`. Private age key NEVER in CI/GitHub: keep in password manager + offline copy. Lose key = backups useless.

- Keys: `daily/wichtelo-YYYY-MM-DD.dump.age`; Sundays also `weekly/…`. Workflow prunes after upload: keep newest 14 daily, 8 weekly. Bucket lifecycle rules optional extra.
- Sanity before encrypt: archive lists >= 5 `TABLE DATA` entries; after upload: size matches `head-object`. Failed run = GitHub failure email to repo owner (Settings → Notifications → Actions: keep "Send notifications for failed workflows only" on). Check Actions tab weekly during Nov-Dec.
- Forks / secrets unset: job skips w/ notice, green.
- `concurrency: db-backup` (no cancel), `timeout-minutes: 30`, `permissions: {}`.
- Secrets (repo, never vars): `SUPABASE_DB_URL_PROD`, `BACKUP_AGE_PUBLIC_KEY`, `BACKUP_S3_ENDPOINT`, `BACKUP_S3_BUCKET`, `BACKUP_S3_ACCESS_KEY_ID`, `BACKUP_S3_SECRET_ACCESS_KEY`, optional `BACKUP_S3_REGION` (default `eu-central-1`).
- `SUPABASE_DB_URL_PROD` = **session pooler** URL (`…pooler.supabase.com:5432`, user `postgres.<ref>`); direct host is IPv6-only, GitHub runners IPv4. URL holds DB password: rotate on leak. Bucket key: write+list+delete on that bucket only; enable bucket versioning/object-lock if provider supports (stops compromised key wiping backups).
- Limits: logical dump only (`public` + `auth`); no storage objects, no Supabase-managed roles, no PITR. Dump holds emails/names → bucket EU, private, encrypted. RPO up to 24h.

### Restore test (`.github/workflows/db-restore-test.yml`)

Weekly Monday + `workflow_dispatch`. Cannot decrypt prod dumps (no private key in CI) → tests the mechanism instead: ephemeral local Supabase stack (migrations applied), seeds canary user+profile, `pg_dump` w/ same flags as backup, `pg_restore` into fresh DB, asserts exact row counts per `public` table + `auth.users`, canary row, function count, RLS-enabled table count. Catches: migration/schema that breaks dump/restore, flag drift. Does NOT prove: bucket contents readable, age key works, prod data restores. So still do manual drill (below) quarterly: download latest `.age`, decrypt with real key, restore into staging.

## Restore procedure

Test quarterly + before draw season, against **staging**, never prod first.

1. `aws s3 cp --endpoint-url $EP s3://$BUCKET/daily/<latest>.dump.age .` then `age -d -i key.txt <file>.dump.age > restore.dump`
2. New/empty project (or `supabase db reset --linked` on staging).
3. Apply schema: `supabase db push` (migrations) — or schema dump.
4. `pg_restore --no-owner --no-privileges --dbname "$DB_URL" restore.dump` (pg client >= 17; schema already there → add `--data-only`; auth schema exists on Supabase → expect benign errors on pre-existing objects)
5. Verify: row counts for `groups`, `memberships`, `assignments`; log in as test user, open drawn group.
6. Prod incident: restore into fresh project, repoint `NEXT_PUBLIC_SUPABASE_*` env in Vercel, update auth redirect config via `supabase config push`.
