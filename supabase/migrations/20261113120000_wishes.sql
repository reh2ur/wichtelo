-- Personal wish list on account level (issue #208, wishlist 1/3).
--
-- A wish belongs to a profile (cascade on account deletion), optionally linked
-- to AT MOST ONE group. Deleting the group (retention) leaves the wish,
-- unassigned. The owner is the only reader/writer through the user JWT
-- (RLS + column grants); group visibility is #209, link metadata #210.

create type public.wish_status as enum ('open', 'received');

create table public.wishes (
  id             uuid primary key default gen_random_uuid(),
  profile_id     uuid not null references public.profiles on delete cascade,
  group_id       uuid references public.groups on delete set null,
  title          text not null,
  url            text,
  note           text,
  price_estimate numeric(7, 2),
  status         public.wish_status not null default 'open',
  received_at    timestamptz,
  created_at     timestamptz not null default now(),
  -- Mirrors the zod schema in lib/wishes/schema.ts.
  constraint wishes_title_length check (char_length(btrim(title)) between 1 and 200),
  constraint wishes_url_format check (
    url is null or (char_length(url) <= 2000 and url ~* '^https?://[^[:space:]]+$')
  ),
  constraint wishes_note_length check (note is null or char_length(note) <= 1000),
  constraint wishes_price_range check (price_estimate is null or price_estimate >= 0),
  constraint wishes_received_at_matches_status check (
    (status = 'received') = (received_at is not null)
  )
);

create index wishes_profile_id_idx on public.wishes (profile_id, status, created_at desc);
create index wishes_group_id_idx   on public.wishes (group_id);

-- ─── Row Level Security: owner only ──────────────────────────────────────────
alter table public.wishes enable row level security;

create policy "wishes: owner can read"
  on public.wishes for select to authenticated
  using (profile_id = auth.uid());

create policy "wishes: owner can insert"
  on public.wishes for insert to authenticated
  with check (profile_id = auth.uid());

create policy "wishes: owner can update"
  on public.wishes for update to authenticated
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

create policy "wishes: owner can delete"
  on public.wishes for delete to authenticated
  using (profile_id = auth.uid());

-- No anon access at all. authenticated may not re-parent a wish
-- (profile_id) or rewrite its id/created_at: UPDATE only on the editable columns.
revoke all on public.wishes from anon, authenticated;
grant select, insert, delete on public.wishes to authenticated;
grant update (title, url, note, price_estimate, group_id, status, received_at)
  on public.wishes to authenticated;
grant select, insert, update, delete on public.wishes to service_role;

-- ─── Integrity: group only if the owner is a member; per-user cap ───────────
-- Security definer so the membership lookup is independent of RLS. Only
-- INSERT / group_id changes are checked: ON DELETE SET NULL (group deletion)
-- and edits of other columns must always pass, even if the owner has left the
-- group since linking it. 500 wishes per account = abuse backstop for direct
-- /rest/v1 inserts (errcode 54000, like create_group).
create function public.check_wish_integrity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform pg_advisory_xact_lock(hashtextextended(new.profile_id::text, 0));
    if (select count(*) from public.wishes where profile_id = new.profile_id) >= 500 then
      raise exception 'wish limit reached' using errcode = '54000';
    end if;
  end if;

  if new.group_id is not null
     and (tg_op = 'INSERT' or new.group_id is distinct from old.group_id) then
    if not exists (
      select 1 from public.memberships
       where group_id = new.group_id and profile_id = new.profile_id
    ) then
      raise exception 'wish group must be a group of the owner'
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.check_wish_integrity() from public, anon, authenticated;

create trigger wishes_check_integrity
  before insert or update of group_id on public.wishes
  for each row execute function public.check_wish_integrity();
