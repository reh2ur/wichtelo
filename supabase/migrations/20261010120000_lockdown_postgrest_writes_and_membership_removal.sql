-- Lock down leftover PostgREST write paths (issue #17) and give post-draw
-- dropouts a deliberate removal path (issue #18).
--
-- The app does every privileged write through the service role. The user JWT
-- only needs: profiles select/insert/update, rpc create_group, and reads of
-- its own memberships / assignments rows (+ groups join). Everything else a
-- logged-in user could do via /rest/v1 bypassed Server Action rules.

-- ─── assignments: giver reads own row only ───────────────────────────────────
-- Admin lookup is the confirmed + audit-logged lookupAssignment action.
drop policy "assignments: admins can read all in group" on public.assignments;
drop policy "assignments: admins can manage" on public.assignments;
revoke insert, update, delete on public.assignments from anon, authenticated;

-- ─── profiles: no direct delete (would skip the account-deletion cascade) ───
drop policy "profiles: owner can delete" on public.profiles;
revoke delete on public.profiles from anon, authenticated;

-- ─── memberships / groups / exclusions / invite_tokens: no user writes ──────
drop policy "memberships: admins can update" on public.memberships;
drop policy "memberships: admins can delete" on public.memberships;
drop policy "memberships: creator can self-insert as first admin" on public.memberships;
revoke insert, update, delete on public.memberships from anon, authenticated;

drop policy "groups: admins can update" on public.groups;
drop policy "groups: admins can delete" on public.groups;
drop policy "groups: authenticated can create" on public.groups;
revoke insert, update, delete on public.groups from anon, authenticated;

drop policy "exclusions: admins can manage" on public.exclusions;
revoke insert, update, delete on public.exclusions from anon, authenticated;

drop policy "invite_tokens: admins can manage" on public.invite_tokens;
revoke insert, update, delete on public.invite_tokens from anon, authenticated;

-- Defense in depth: none of these are reachable through PostgREST, but the
-- platform default grants may include them.
revoke truncate, references, trigger on
  public.profiles, public.groups, public.memberships,
  public.assignments, public.exclusions, public.invite_tokens
  from anon, authenticated;

-- Only used by the dropped self-insert policy; any authenticated user could
-- call them via /rest/v1/rpc (group existence leak).
drop function public.is_group_creator(uuid);
drop function public.group_has_members(uuid);

-- ─── groups: integrity constraints (service role writes too) ────────────────
-- NOT VALID: enforced for new/updated rows without failing on legacy data.
-- 'neu' collides with the /gruppen/neu route.
alter table public.groups
  add constraint groups_name_not_blank check (char_length(btrim(name)) >= 1) not valid,
  add constraint groups_year_range check (year between 2000 and 2100) not valid,
  add constraint groups_slug_format check (slug ~ '^[a-z0-9-]{1,120}$' and slug <> 'neu') not valid;

-- ─── create_group: validate input ────────────────────────────────────────────
-- Same body as 20261009120000 plus validation. Reserved slugs are skipped (a
-- group named "Neu" gets "neu-2"); malformed slugs are rejected outright.
create or replace function public.create_group(
  p_name text,
  p_year smallint,
  p_budget_hint text,
  p_note text,
  p_slugs text[]
)
returns table (group_id uuid, slug text, invite_token text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_profile public.profiles%rowtype;
  v_group_id uuid := gen_random_uuid();
  v_slug text;
  v_inserted boolean := false;
  v_token text;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  if p_name is null or char_length(btrim(p_name)) not between 1 and 100 then
    raise exception 'invalid group name' using errcode = '22023';
  end if;
  if p_year is null or p_year not between 2000 and 2100 then
    raise exception 'invalid group year' using errcode = '22023';
  end if;
  if coalesce(cardinality(p_slugs), 0) > 50 then
    raise exception 'too many slug candidates' using errcode = '22023';
  end if;
  foreach v_slug in array coalesce(p_slugs, '{}') loop
    if v_slug is null or v_slug !~ '^[a-z0-9-]{1,120}$' then
      raise exception 'invalid slug' using errcode = '22023';
    end if;
  end loop;

  select * into v_profile from public.profiles where id = v_user;
  if not found then
    raise exception 'profile required' using errcode = 'P0002';
  end if;

  foreach v_slug in array coalesce(p_slugs, '{}') loop
    if v_slug = 'neu' then
      continue;
    end if;
    begin
      insert into public.groups (id, slug, name, year, state, budget_hint, note, created_by)
      values (v_group_id, v_slug, p_name, p_year, 'open', p_budget_hint, p_note, v_user);
      v_inserted := true;
      exit;
    exception when unique_violation then
      -- slug taken: try next candidate
      null;
    end;
  end loop;

  if not v_inserted then
    raise exception 'no free slug' using errcode = '23505';
  end if;

  insert into public.memberships
    (group_id, profile_id, name_snapshot, first_name_snapshot, last_name_snapshot, role)
  values (
    v_group_id, v_user,
    v_profile.first_name || ' ' || v_profile.last_name,
    v_profile.first_name, v_profile.last_name, 'admin'
  );

  insert into public.invite_tokens (group_id, token)
  values (v_group_id, gen_random_uuid()::text)
  returning token into v_token;

  return query select v_group_id, v_slug, v_token;
end;
$$;

-- ─── memberships: drawn-guard + locked removal RPC ───────────────────────────
-- A membership delete in a drawn group cascades away the member's giver and
-- receiver assignment rows (someone silently gets no gift). Plain deletes are
-- rejected once the group is drawn. Exempt:
--   * group deletion: the parent row is already gone, so the lookup finds no
--     group and the cascade passes;
--   * deliberate removal inside remove_membership / perform_draw, which set the
--     transaction-local flag app.allow_drawn_membership_delete. Only those
--     security-definer functions (service role only) can set it: PostgREST
--     cannot run arbitrary SQL and no user role holds DELETE any more.
-- FOR SHARE conflicts with the FOR UPDATE in perform_draw / remove_membership,
-- so a delete and a concurrent draw serialize and the loser sees the new state.
create function public.reject_membership_delete_when_drawn()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_state public.group_state;
begin
  if coalesce(current_setting('app.allow_drawn_membership_delete', true), '') = 'on' then
    return old;
  end if;
  select state into v_state from public.groups where id = old.group_id for share;
  if v_state = 'drawn' then
    raise exception 'group is already drawn' using errcode = 'P0001';
  end if;
  return old;
end;
$$;

create trigger memberships_reject_delete_when_drawn
  before delete on public.memberships
  for each row execute function public.reject_membership_delete_when_drawn();

-- Removes one membership under a row lock on the group.
-- Returns ok | group_not_found | member_not_found | already_drawn | last_admin.
--   p_allow_drawn: admin removal after the draw (assignment rows of the
--     member as giver/receiver cascade away; admin must re-draw afterwards).
--   p_enforce_last_admin: refuse to remove the last live-account admin.
create function public.remove_membership(
  p_group_id uuid,
  p_membership_id uuid,
  p_allow_drawn boolean default false,
  p_enforce_last_admin boolean default true
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_state public.group_state;
  v_role public.member_role;
begin
  select state into v_state from public.groups where id = p_group_id for update;
  if not found then
    return 'group_not_found';
  end if;

  if v_state = 'drawn' and not p_allow_drawn then
    return 'already_drawn';
  end if;

  select role into v_role from public.memberships
   where id = p_membership_id and group_id = p_group_id for update;
  if not found then
    return 'member_not_found';
  end if;

  if p_enforce_last_admin and v_role = 'admin' and not exists (
    select 1 from public.memberships
     where group_id = p_group_id
       and role = 'admin'
       and profile_id is not null
       and id <> p_membership_id
  ) then
    return 'last_admin';
  end if;

  if v_state = 'drawn' then
    perform set_config('app.allow_drawn_membership_delete', 'on', true);
  end if;
  delete from public.memberships where id = p_membership_id;
  perform set_config('app.allow_drawn_membership_delete', 'off', true);

  return 'ok';
end;
$$;

revoke all on function public.remove_membership(uuid, uuid, boolean, boolean)
  from public, anon, authenticated;
grant execute on function public.remove_membership(uuid, uuid, boolean, boolean)
  to service_role;

-- ─── perform_draw: re-draw drops ghost members ───────────────────────────────
-- A drawn group keeps memberships whose account was deleted (profile_id NULL).
-- Re-draw now ignores them in the giver-set check and deletes them atomically
-- with the new assignments, so the new draw only contains live members. The
-- delete happens after all early-return checks: returning (not raising)
-- commits, so ghosts must survive a rejected draw.
create or replace function public.perform_draw(
  p_group_id uuid,
  p_pairs jsonb,
  p_expected_state public.group_state,
  p_expected_version integer
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group public.groups%rowtype;
  v_member_ids uuid[];
  v_giver_ids uuid[];
begin
  select * into v_group from public.groups where id = p_group_id for update;
  if not found then
    return 'group_not_found';
  end if;

  if v_group.state <> p_expected_state
     or v_group.draw_version <> p_expected_version then
    return 'state_changed';
  end if;

  if v_group.state = 'open' and exists (
    select 1 from public.memberships
     where group_id = p_group_id and profile_id is null
  ) then
    return 'ghost_members';
  end if;

  -- Draw was computed from a snapshot of live members; reject if it drifted.
  -- Ghosts (drawn groups only, see above) are excluded.
  select coalesce(array_agg(id order by id), '{}') into v_member_ids
    from public.memberships
   where group_id = p_group_id and profile_id is not null;
  select coalesce(array_agg((p->>'giver_id')::uuid order by (p->>'giver_id')::uuid), '{}')
    into v_giver_ids
    from jsonb_array_elements(p_pairs) p;
  if v_member_ids <> v_giver_ids then
    return 'membership_changed';
  end if;

  if v_group.state = 'drawn' then
    perform set_config('app.allow_drawn_membership_delete', 'on', true);
    delete from public.memberships
     where group_id = p_group_id and profile_id is null;
    perform set_config('app.allow_drawn_membership_delete', 'off', true);
  end if;

  delete from public.assignments where group_id = p_group_id;

  insert into public.assignments (group_id, giver_id, receiver_id)
  select p_group_id, (p->>'giver_id')::uuid, (p->>'receiver_id')::uuid
    from jsonb_array_elements(p_pairs) p;

  update public.groups
     set state = 'drawn', draw_version = draw_version + 1
   where id = p_group_id;

  return 'ok';
end;
$$;
