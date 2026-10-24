-- Durable audit trail for the admin assignment lookup ("oracle", issue #135).
--
-- The lookupAssignment action used to write only an actor-less log line. It
-- now inserts one row per revealed assignment (actor, group, target) before
-- returning the receiver. Service role only: RLS on without policies, all
-- anon/authenticated privileges revoked. Rows cascade with the group; the
-- actor/target links are nulled (row kept) when the account/membership goes.

create table public.assignment_lookups (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  actor_profile_id uuid references public.profiles(id) on delete set null,
  target_membership_id uuid references public.memberships(id) on delete set null,
  looked_up_at timestamptz not null default now()
);

create index assignment_lookups_group_id_idx
  on public.assignment_lookups (group_id, looked_up_at desc);

create index assignment_lookups_actor_idx
  on public.assignment_lookups (actor_profile_id);
create index assignment_lookups_target_idx
  on public.assignment_lookups (target_membership_id);

alter table public.assignment_lookups enable row level security;

revoke all on public.assignment_lookups from public, anon, authenticated;
grant select, insert on public.assignment_lookups to service_role;
