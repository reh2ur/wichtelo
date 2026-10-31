-- Hardening nits (#164): non-empty profile names, bounded snapshot columns,
-- create_group validates budget_hint / note, reject_join_when_drawn search_path.

-- NOT VALID: enforced for new/updated rows without failing on legacy data.
-- Upper bounds (<= 50 / 100 / 200 / 1000) already exist from earlier migrations.
alter table public.profiles
  add constraint profiles_first_name_not_blank check (char_length(btrim(first_name)) >= 1) not valid,
  add constraint profiles_last_name_not_blank  check (char_length(btrim(last_name)) >= 1) not valid;

alter table public.memberships
  add constraint memberships_first_name_snapshot_length check (char_length(first_name_snapshot) <= 50) not valid,
  add constraint memberships_last_name_snapshot_length  check (char_length(last_name_snapshot) <= 50) not valid;

-- ─── create_group: also validate budget_hint / note ──────────────────────────
-- Same body as 20261016120000 plus the two length checks.
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
  if char_length(p_budget_hint) > 200 then
    raise exception 'budget hint too long' using errcode = '22023';
  end if;
  if char_length(p_note) > 1000 then
    raise exception 'note too long' using errcode = '22023';
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

-- ─── reject_join_when_drawn: hardened search_path ────────────────────────────
-- Same body as 20261007190000; all references already schema-qualified.
create or replace function public.reject_join_when_drawn()
returns trigger
language plpgsql
security definer
set search_path = ''
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
