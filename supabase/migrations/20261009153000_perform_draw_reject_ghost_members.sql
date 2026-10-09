-- Reject draws that include ghost members (issue #244).
--
-- A membership with profile_id IS NULL in an open group is a deleted account
-- that was never cleaned up. It must not be drawn. perform_draw now returns
-- 'ghost_members' for open groups containing such rows. Drawn groups legitimately
-- keep nulled memberships (deleted account after draw), so re-draws are unaffected.

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

  -- Draw was computed from a membership snapshot; reject if it drifted.
  select coalesce(array_agg(id order by id), '{}') into v_member_ids
    from public.memberships where group_id = p_group_id;
  select coalesce(array_agg((p->>'giver_id')::uuid order by (p->>'giver_id')::uuid), '{}')
    into v_giver_ids
    from jsonb_array_elements(p_pairs) p;
  if v_member_ids <> v_giver_ids then
    return 'membership_changed';
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
