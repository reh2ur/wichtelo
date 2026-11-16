-- Admins can never demote themselves (issue #206).
--
-- Adds p_caller_membership_id: equal to the target -> 'self_demote'. Checked
-- after the group lock, before any role logic. last_admin guard stays as
-- defense in depth.
-- Returns ok | group_not_found | member_not_found | not_admin | self_demote
--       | last_admin.

drop function public.demote_admin(uuid, uuid);

create function public.demote_admin(
  p_group_id uuid,
  p_membership_id uuid,
  p_caller_membership_id uuid
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role public.member_role;
begin
  perform 1 from public.groups where id = p_group_id for update;
  if not found then
    return 'group_not_found';
  end if;

  if p_membership_id = p_caller_membership_id then
    return 'self_demote';
  end if;

  select role into v_role from public.memberships
   where id = p_membership_id and group_id = p_group_id for update;
  if not found then
    return 'member_not_found';
  end if;

  if v_role <> 'admin' then
    return 'not_admin';
  end if;

  if not exists (
    select 1 from public.memberships
     where group_id = p_group_id
       and role = 'admin'
       and profile_id is not null
       and id <> p_membership_id
  ) then
    return 'last_admin';
  end if;

  update public.memberships set role = 'participant'
   where id = p_membership_id;

  return 'ok';
end;
$$;

revoke all on function public.demote_admin(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.demote_admin(uuid, uuid, uuid) to service_role;
