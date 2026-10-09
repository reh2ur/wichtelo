-- Fix RLS gaps that allow authorization bypass via direct PostgREST calls
-- with the public anon key (bypassing the app's Server Actions entirely).
--
-- 1. invite_tokens: drop public "read by token" policy. resolveToken/createToken/
--    getOrCreateToken (lib/invite/index.ts) already use the service-role client —
--    no anon-key table access is needed.
-- 2. memberships: drop unrestricted "authenticated can join" self-insert policy.
--    acceptInvite (app/einladung/[token]/actions.ts) already joins members via the
--    service-role client with role hardcoded to 'participant'. The only real anon-key
--    self-insert path is createGroup (app/gruppen/neu/actions.ts), where the creator
--    inserts themself as the group's first (and only self-insertable) admin — so the
--    replacement policy scopes to exactly that case. The checks run through security
--    definer helpers (like is_member/is_admin) because the caller can't yet see the
--    group or membership rows through ordinary RLS-gated selects at this point.
-- 3. groups: bind created_by to the caller and forbid creating a group already in
--    'drawn' state.

drop policy "invite_tokens: public can read by token" on public.invite_tokens;

drop policy "memberships: authenticated can join" on public.memberships;

create function public.is_group_creator(p_group_id uuid)
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from public.groups
    where id = p_group_id
      and created_by = auth.uid()
  )
$$;

create function public.group_has_members(p_group_id uuid)
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from public.memberships
    where group_id = p_group_id
  )
$$;

create policy "memberships: creator can self-insert as first admin"
  on public.memberships for insert
  with check (
    auth.uid() is not null
    and profile_id = auth.uid()
    and role = 'admin'::public.member_role
    and public.is_group_creator(group_id)
    and not public.group_has_members(group_id)
  );

drop policy "groups: authenticated can create" on public.groups;

create policy "groups: authenticated can create"
  on public.groups for insert
  with check (
    auth.uid() is not null
    and created_by = auth.uid()
    and state = 'open'::public.group_state
  );
