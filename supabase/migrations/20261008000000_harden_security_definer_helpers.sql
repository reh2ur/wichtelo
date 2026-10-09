-- Harden SECURITY DEFINER RLS helpers (issue #191).
--
-- 1. Pin search_path = '' (Supabase linter 0011, search-path hijacking). Bodies
--    already schema-qualify every reference (public.*, auth.uid()).
-- 2. Revoke EXECUTE from public/anon so the helpers are no longer callable via
--    /rest/v1/rpc (e.g. group_has_members(uuid) leaked group existence).
--    Only `authenticated` (RLS evaluation) and service_role keep access.
-- 3. Policies calling the helpers are scoped `to authenticated`; otherwise an
--    anon request would fail with "permission denied for function" while
--    evaluating them instead of just seeing zero rows.

alter function public.is_member(uuid)          set search_path = '';
alter function public.is_admin(uuid)           set search_path = '';
alter function public.is_group_creator(uuid)   set search_path = '';
alter function public.group_has_members(uuid)  set search_path = '';

revoke execute on function public.is_member(uuid)         from public, anon;
revoke execute on function public.is_admin(uuid)          from public, anon;
revoke execute on function public.is_group_creator(uuid)  from public, anon;
revoke execute on function public.group_has_members(uuid) from public, anon;

grant execute on function public.is_member(uuid)         to authenticated, service_role;
grant execute on function public.is_admin(uuid)          to authenticated, service_role;
grant execute on function public.is_group_creator(uuid)  to authenticated, service_role;
grant execute on function public.group_has_members(uuid) to authenticated, service_role;

alter policy "groups: members can read"   on public.groups to authenticated;
alter policy "groups: admins can update"  on public.groups to authenticated;
alter policy "groups: admins can delete"  on public.groups to authenticated;

alter policy "memberships: members can read own group" on public.memberships to authenticated;
alter policy "memberships: admins can insert"          on public.memberships to authenticated;
alter policy "memberships: admins can update"          on public.memberships to authenticated;
alter policy "memberships: admins can delete"          on public.memberships to authenticated;
alter policy "memberships: creator can self-insert as first admin"
  on public.memberships to authenticated;

alter policy "assignments: admins can read all in group" on public.assignments to authenticated;
alter policy "assignments: admins can manage"            on public.assignments to authenticated;

alter policy "exclusions: admins can manage" on public.exclusions to authenticated;

alter policy "invite_tokens: members can read"   on public.invite_tokens to authenticated;
alter policy "invite_tokens: admins can manage"  on public.invite_tokens to authenticated;
