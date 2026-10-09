-- admin_audit_log has no RLS policies by design (service-role only, see
-- lib/admin/audit.ts). RLS being off does not itself block access — Postgres
-- default grants to anon/authenticated could still allow reads/writes.
-- Revoke explicitly so the "service-role only" claim is enforced by Postgres,
-- not just convention.
revoke all on public.admin_audit_log from anon, authenticated;
