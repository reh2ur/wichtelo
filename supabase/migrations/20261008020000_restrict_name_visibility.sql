-- Stop leaking full names to co-members via direct PostgREST (issue #179,
-- PRD story 32). The UI shows abbreviated names; RLS must match.
--
-- All pages that display other members' names read them with the service
-- role and run abbreviateNames() server-side (admins see full names there).
--
-- profiles: owner only (was: any co-member could read full last_name).
-- memberships: own row, or every row of a group the caller administers
--   (was: every member of the group — exposed name_snapshot).

drop policy "profiles: co-members can read" on public.profiles;

create policy "profiles: owner can read"
  on public.profiles for select
  to authenticated
  using (id = auth.uid());

drop policy "memberships: members can read own group" on public.memberships;

create policy "memberships: own row or group admin can read"
  on public.memberships for select
  to authenticated
  using (profile_id = auth.uid() or public.is_admin(group_id));
