-- Close RLS write gaps reachable via direct PostgREST calls (issue #178).
-- The app does all privileged writes through the service role; the user JWT
-- must not be able to do more than the Server Actions allow.

-- ─── groups: admins may only edit name/year/budget_hint/note ─────────────────
-- Table-level UPDATE (from 20260920060842) would make a column REVOKE a no-op,
-- so revoke the table privilege and grant back the editable columns only.
-- created_by, slug, state, draw_version stay immutable for user JWTs.
revoke update on public.groups from anon, authenticated;
grant update (name, year, budget_hint, note) on public.groups to authenticated;

-- ─── memberships ─────────────────────────────────────────────────────────────
-- Joins go through the service role (acceptInvite); the creator's first-admin
-- insert has its own policy. No generic admin INSERT.
drop policy "memberships: admins can insert" on public.memberships;

-- Admins may only change `role`; profile_id / group_id / name_snapshot are
-- immutable for user JWTs. WITH CHECK keeps the row inside the admin's group.
revoke update on public.memberships from anon, authenticated;
grant update (role) on public.memberships to authenticated;

alter policy "memberships: admins can update"
  on public.memberships
  with check (public.is_admin(group_id));

-- ─── profiles: owner may only change names; id immutable ─────────────────────
revoke update on public.profiles from anon, authenticated;
grant update (first_name, last_name) on public.profiles to authenticated;

-- ─── length limits matching the zod schemas ──────────────────────────────────
-- NOT VALID: enforced for new/updated rows without failing on legacy data.
alter table public.groups
  add constraint groups_name_length        check (char_length(name) <= 100) not valid,
  add constraint groups_note_length        check (char_length(note) <= 1000) not valid,
  add constraint groups_budget_hint_length check (char_length(budget_hint) <= 200) not valid;

alter table public.profiles
  add constraint profiles_first_name_length check (char_length(first_name) <= 50) not valid,
  add constraint profiles_last_name_length  check (char_length(last_name) <= 50) not valid;

-- first (<=50) + space + last (<=50)
alter table public.memberships
  add constraint memberships_name_snapshot_length check (char_length(name_snapshot) <= 101) not valid;
