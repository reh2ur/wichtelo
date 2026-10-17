-- DB hardening: #105 (account deletion vs. re-draw race), #107 (invite_tokens
-- readable by members, create_group without DB-level cap), #111 (perform_draw
-- search_path).

-- ─── #107: invite_tokens not readable via PostgREST ──────────────────────────
-- UI shows the invite link to admins only and all app code reads the table
-- through the service role. The member-read policy let any participant fetch
-- the live token with their own JWT.
drop policy "invite_tokens: members can read" on public.invite_tokens;
revoke select on public.invite_tokens from anon, authenticated;

-- ─── #107: create_group cap inside the RPC ───────────────────────────────────
-- The app limiter (5 / 24 h) only guards the Server Action; the RPC is
-- directly callable with any user JWT. Same body as 20261010120000 plus: count
-- the caller's groups created in the last 24 h, refuse the 6th. Per-user
-- advisory lock serializes parallel calls so they cannot all pass the count.
-- Stays executable by `authenticated` (auth.uid() semantics, no deploy-order
-- break against the previous app version). Error code 54000 =
-- program_limit_exceeded; createGroup maps it to the rate_limited message.
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

  perform pg_advisory_xact_lock(hashtextextended('create_group:' || v_user::text, 0));
  if (
    select count(*) from public.groups g
     where g.created_by = v_user
       and g.created_at > now() - interval '24 hours'
  ) >= 5 then
    raise exception 'group creation limit reached' using errcode = '54000';
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

-- ─── #111: perform_draw with hardened search_path ────────────────────────────
-- Same body as 20261010120000; only `set search_path = public` -> ''. Every
-- reference is already schema-qualified or in pg_catalog.
create or replace function public.perform_draw(
  p_group_id uuid,
  p_pairs jsonb,
  p_expected_state public.group_state,
  p_expected_version integer
)
returns text
language plpgsql
security definer
set search_path = ''
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

-- ─── #105: ghost-ify drawn memberships under the group lock ──────────────────
-- Account deletion relied on the memberships.profile_id ON DELETE SET NULL
-- cascade for drawn groups. That cascade never locks the group row, so it could
-- commit between a re-draw's member snapshot and perform_draw's own member
-- read. This RPC nulls profile_id for every drawn-group membership of the
-- profile, locking each group row FOR UPDATE first (same lock perform_draw
-- takes), so the two serialize. deleteAccount calls it before deleteUser; the
-- later FK cascade then finds nothing left to null in drawn groups.
-- Groups are locked in id order (no lock-order deadlocks between callers).
-- Returns the number of memberships nulled.
create function public.ghost_drawn_memberships(p_profile_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_group_id uuid;
  v_count integer := 0;
  v_rows integer;
begin
  for v_group_id in
    select m.group_id from public.memberships m
     where m.profile_id = p_profile_id
     order by m.group_id
  loop
    -- State is read after the lock: a draw that committed while we waited
    -- is seen. Open groups are left alone (handled by remove_membership).
    perform 1 from public.groups g
     where g.id = v_group_id and g.state = 'drawn'
       for update;
    if found then
      update public.memberships
         set profile_id = null
       where group_id = v_group_id and profile_id = p_profile_id;
      get diagnostics v_rows = row_count;
      v_count := v_count + v_rows;
    end if;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.ghost_drawn_memberships(uuid)
  from public, anon, authenticated;
grant execute on function public.ghost_drawn_memberships(uuid) to service_role;
