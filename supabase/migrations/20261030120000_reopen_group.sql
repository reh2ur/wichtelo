-- Atomic super-admin reopen (issue #154).
--
-- Plain `update groups set state = 'open'` left old assignments (readable by
-- givers via RLS while open), the draw_mail_failures row and raced with a
-- concurrent draw / member removal. This RPC locks the group row, drops the
-- stale draw artefacts and flips the state in one txn.
-- draw_version is kept (monotonic): a stale mail-failure write for the old
-- draw can never match a future version.
-- Returns ok | group_not_found | not_drawn.

create function public.reopen_group(p_group_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_state public.group_state;
begin
  select state into v_state from public.groups where id = p_group_id for update;
  if not found then
    return 'group_not_found';
  end if;

  if v_state <> 'drawn' then
    return 'not_drawn';
  end if;

  delete from public.assignments where group_id = p_group_id;
  delete from public.draw_mail_failures where group_id = p_group_id;
  update public.groups set state = 'open' where id = p_group_id;

  return 'ok';
end;
$$;

revoke all on function public.reopen_group(uuid)
  from public, anon, authenticated;
grant execute on function public.reopen_group(uuid) to service_role;
