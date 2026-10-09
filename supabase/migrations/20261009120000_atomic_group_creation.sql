-- Atomic group creation (issue #241).
--
-- createGroup inserted group, then admin membership, as separate PostgREST
-- calls and cleaned up orphans with the service role (best effort). A crash
-- between the steps left an orphan group holding its slug. create_group does
-- group + admin membership + invite token in one transaction.
--
-- Caller = auth.uid(); needs an existing profile. Slug conflicts (23505) are
-- retried over the candidate list inside the function: each attempt runs in
-- its own subtransaction, so a failed insert leaves no partial state.

create function public.create_group(
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

  select * into v_profile from public.profiles where id = v_user;
  if not found then
    raise exception 'profile required' using errcode = 'P0002';
  end if;

  foreach v_slug in array coalesce(p_slugs, '{}') loop
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

revoke all on function public.create_group(text, smallint, text, text, text[])
  from public, anon;
grant execute on function public.create_group(text, smallint, text, text, text[])
  to authenticated;
