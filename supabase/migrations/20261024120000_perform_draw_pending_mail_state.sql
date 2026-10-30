-- Make the "mails not confirmed sent" state transactional (issue #140).
--
-- perform_draw commits the draw, then the app resolves recipients, sends mails
-- and only afterwards records the outcome. A timeout/kill/exception between
-- commit and bookkeeping left a drawn group with no mails and no resend
-- button (the button renders only when a draw_mail_failures row exists).
--
-- perform_draw now upserts that row in the same transaction as the draw:
-- failed = total = live members, draw_version = the new version. The app then
-- either clears it (record_draw_mail_result with failed = 0 after a clean send)
-- or rewrites the counts after a partial failure. Body otherwise identical to
-- 20261016120000.
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
  v_live integer;
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

  -- Pending mail state: nobody is confirmed mailed yet. Replaces any row of
  -- the previous draw; the version is the post-draw one the mail send uses.
  v_live := cardinality(v_member_ids);
  if v_live > 0 then
    insert into public.draw_mail_failures (group_id, draw_version, failed, total)
    values (p_group_id, v_group.draw_version + 1, v_live, v_live)
    on conflict (group_id) do update
      set draw_version = excluded.draw_version,
          failed = excluded.failed,
          total = excluded.total,
          updated_at = now();
  end if;

  return 'ok';
end;
$$;
