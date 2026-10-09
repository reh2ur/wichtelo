-- Atomic draw / re-draw (issue #168).
--
-- triggerDraw/retriggerDraw used separate PostgREST calls (check state, delete,
-- insert, update state) — concurrent draws interleaved and partial failures
-- left the group half-drawn. perform_draw does it all in one transaction under
-- a row lock on the group, so exactly one concurrent caller wins.

-- Bumped on every successful draw; lets a re-draw detect that another re-draw
-- landed between its read and its write.
alter table public.groups add column draw_version integer not null default 0;

create function public.perform_draw(
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

revoke all on function public.perform_draw(uuid, jsonb, public.group_state, integer)
  from public, anon, authenticated;
grant execute on function public.perform_draw(uuid, jsonb, public.group_state, integer)
  to service_role;

-- No joins into a drawn group. FOR SHARE on the group row conflicts with the
-- FOR UPDATE in perform_draw, so a join and a draw serialize.
create function public.reject_join_when_drawn()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_state public.group_state;
begin
  select state into v_state from public.groups where id = new.group_id for share;
  if v_state = 'drawn' then
    raise exception 'group is already drawn' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger memberships_reject_join_when_drawn
  before insert on public.memberships
  for each row execute function public.reject_join_when_drawn();
