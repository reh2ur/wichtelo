-- Audit log for super-admin back-office actions. No RLS: only accessible via
-- service role key from Server Actions (lib/admin/audit.ts).
create table public.admin_audit_log (
  id          uuid primary key default gen_random_uuid(),
  actor_email text not null,
  action      text not null,      -- ban_user | unban_user | delete_user | delete_group | reopen_group
  target_type text not null,      -- 'user' | 'group'
  target_id   text not null,
  metadata    jsonb,
  created_at  timestamptz not null default now()
);
