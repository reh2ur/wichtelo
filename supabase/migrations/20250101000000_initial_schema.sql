-- profiles: one row per auth.users entry, created on first sign-in
create table public.profiles (
  id         uuid primary key references auth.users on delete cascade,
  first_name text not null,
  last_name  text not null,
  created_at timestamptz not null default now()
);

-- groups (Gruppen)
create type public.group_state as enum ('open', 'drawn');

create table public.groups (
  id          uuid primary key default gen_random_uuid(),
  slug        text unique not null,
  name        text not null,
  year        smallint not null default extract(year from now())::smallint,
  state       public.group_state not null default 'open',
  budget_hint text,
  note        text,
  created_by  uuid not null references public.profiles on delete restrict,
  created_at  timestamptz not null default now()
);

-- memberships: links profiles to groups; profile_id nullable to preserve name after deletion
create type public.member_role as enum ('participant', 'admin');

create table public.memberships (
  id            uuid primary key default gen_random_uuid(),
  group_id      uuid not null references public.groups on delete cascade,
  profile_id    uuid references public.profiles on delete set null,
  name_snapshot text not null,
  role          public.member_role not null default 'participant',
  joined_at     timestamptz not null default now(),
  unique (group_id, profile_id)
);

-- assignments: one row per giver/receiver pair; overwritten entirely on re-draw
create table public.assignments (
  id          uuid primary key default gen_random_uuid(),
  group_id    uuid not null references public.groups on delete cascade,
  giver_id    uuid not null references public.memberships on delete cascade,
  receiver_id uuid not null references public.memberships on delete cascade,
  created_at  timestamptz not null default now(),
  unique (group_id, giver_id),
  unique (group_id, receiver_id)
);

-- exclusions: bidirectional pairs; canonical ordering (member_a < member_b) enforced
create table public.exclusions (
  id       uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups on delete cascade,
  member_a uuid not null references public.memberships on delete cascade,
  member_b uuid not null references public.memberships on delete cascade,
  unique (group_id, member_a, member_b),
  constraint canonical_order check (member_a < member_b)
);

-- invite_tokens: one active token per group; logically invalid when group state = 'drawn'
create table public.invite_tokens (
  id         uuid primary key default gen_random_uuid(),
  group_id   uuid not null references public.groups on delete cascade,
  token      text unique not null default encode(extensions.gen_random_bytes(24), 'base64url'),
  created_at timestamptz not null default now()
);

-- ─── Row Level Security ───────────────────────────────────────────────────────

alter table public.profiles     enable row level security;
alter table public.groups       enable row level security;
alter table public.memberships  enable row level security;
alter table public.assignments  enable row level security;
alter table public.exclusions   enable row level security;
alter table public.invite_tokens enable row level security;

-- Helper: returns true when the caller is a member of the given group
create function public.is_member(p_group_id uuid)
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from public.memberships
    where group_id = p_group_id
      and profile_id = auth.uid()
  )
$$;

-- Helper: returns true when the caller is an admin of the given group
create function public.is_admin(p_group_id uuid)
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from public.memberships
    where group_id   = p_group_id
      and profile_id = auth.uid()
      and role       = 'admin'
  )
$$;

-- profiles: readable by co-members; writable only by the owner
create policy "profiles: co-members can read"
  on public.profiles for select
  using (
    id = auth.uid()
    or exists (
      select 1 from public.memberships m1
      join public.memberships m2 on m1.group_id = m2.group_id
      where m1.profile_id = auth.uid()
        and m2.profile_id = profiles.id
    )
  );

create policy "profiles: owner can insert"
  on public.profiles for insert
  with check (id = auth.uid());

create policy "profiles: owner can update"
  on public.profiles for update
  using (id = auth.uid());

create policy "profiles: owner can delete"
  on public.profiles for delete
  using (id = auth.uid());

-- groups: readable by members; insertable by authenticated; updatable/deletable by admins
create policy "groups: members can read"
  on public.groups for select
  using (public.is_member(id));

create policy "groups: authenticated can create"
  on public.groups for insert
  with check (auth.uid() is not null);

create policy "groups: admins can update"
  on public.groups for update
  using (public.is_admin(id));

create policy "groups: admins can delete"
  on public.groups for delete
  using (public.is_admin(id));

-- memberships: readable by group members; insertable by anyone for joining; managed by admins
create policy "memberships: members can read own group"
  on public.memberships for select
  using (public.is_member(group_id));

create policy "memberships: authenticated can join"
  on public.memberships for insert
  with check (auth.uid() is not null and profile_id = auth.uid());

create policy "memberships: admins can insert"
  on public.memberships for insert
  with check (public.is_admin(group_id));

create policy "memberships: admins can update"
  on public.memberships for update
  using (public.is_admin(group_id));

create policy "memberships: admins can delete"
  on public.memberships for delete
  using (public.is_admin(group_id));

-- assignments: participants see only their own row; admins see all rows in their group
create policy "assignments: giver can read own row"
  on public.assignments for select
  using (
    exists (
      select 1 from public.memberships
      where id = assignments.giver_id
        and profile_id = auth.uid()
    )
  );

create policy "assignments: admins can read all in group"
  on public.assignments for select
  using (public.is_admin(group_id));

create policy "assignments: admins can manage"
  on public.assignments for all
  using (public.is_admin(group_id));

-- exclusions: readable and manageable by admins only
create policy "exclusions: admins can manage"
  on public.exclusions for all
  using (public.is_admin(group_id));

-- invite_tokens: readable by group members; manageable by admins
create policy "invite_tokens: members can read"
  on public.invite_tokens for select
  using (public.is_member(group_id));

create policy "invite_tokens: admins can manage"
  on public.invite_tokens for all
  using (public.is_admin(group_id));

-- unauthenticated token lookup for invite landing page (token resolution only)
create policy "invite_tokens: public can read by token"
  on public.invite_tokens for select
  using (true);
