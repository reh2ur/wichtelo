-- Explicitly grant table privileges to anon/authenticated/service_role.
--
-- These grants are normally applied once, automatically, by the Supabase
-- platform when a project is provisioned — not tracked as a migration.
-- Supabase Preview Branching does not replicate that one-time bootstrap step,
-- so branches created for PR previews end up with anon/authenticated/
-- service_role missing SELECT/INSERT/UPDATE/DELETE entirely on every public
-- table (confirmed via `supabase db query --linked` against a failing
-- preview branch vs. the main project). RLS policies still gate actual row
-- access — these grants only clear the table-level permission check that
-- happens before RLS is even evaluated.
--
-- admin_audit_log is deliberately excluded — 20260802020000 revoked
-- anon/authenticated access there (service-role only, see lib/admin/audit.ts)
-- and this migration must not undo that.

grant select, insert, update, delete on
  public.profiles,
  public.groups,
  public.memberships,
  public.assignments,
  public.exclusions,
  public.invite_tokens
  to anon, authenticated, service_role;

grant select, insert, update, delete on public.admin_audit_log to service_role;
