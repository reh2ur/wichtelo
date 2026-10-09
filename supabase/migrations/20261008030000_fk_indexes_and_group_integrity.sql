-- DB performance / integrity (issue #204).

-- ─── FK indexes (cascades, per-user group lists, RLS helpers) ───────────────
create index memberships_profile_id_idx  on public.memberships (profile_id);
create index assignments_giver_id_idx    on public.assignments (giver_id);
create index assignments_receiver_id_idx on public.assignments (receiver_id);
create index exclusions_member_a_idx     on public.exclusions (member_a);
create index exclusions_member_b_idx     on public.exclusions (member_b);

-- ─── no self-assignment ──────────────────────────────────────────────────────
alter table public.assignments
  add constraint assignments_no_self check (giver_id <> receiver_id);

-- ─── same-group integrity via composite FKs ─────────────────────────────────
-- giver, receiver and both exclusion members must belong to the row's group_id.
alter table public.memberships
  add constraint memberships_id_group_id_key unique (id, group_id);

alter table public.assignments
  drop constraint assignments_giver_id_fkey,
  drop constraint assignments_receiver_id_fkey,
  add constraint assignments_giver_same_group_fkey
    foreign key (giver_id, group_id)
    references public.memberships (id, group_id) on delete cascade,
  add constraint assignments_receiver_same_group_fkey
    foreign key (receiver_id, group_id)
    references public.memberships (id, group_id) on delete cascade;

alter table public.exclusions
  drop constraint exclusions_member_a_fkey,
  drop constraint exclusions_member_b_fkey,
  add constraint exclusions_member_a_same_group_fkey
    foreign key (member_a, group_id)
    references public.memberships (id, group_id) on delete cascade,
  add constraint exclusions_member_b_same_group_fkey
    foreign key (member_b, group_id)
    references public.memberships (id, group_id) on delete cascade;
