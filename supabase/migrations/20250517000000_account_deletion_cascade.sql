-- Allow created_by to be nulled when a profile is deleted (account deletion cascade).
-- memberships.profile_id already has ON DELETE SET NULL; this mirrors that for groups.
alter table public.groups alter column created_by drop not null;
alter table public.groups drop constraint groups_created_by_fkey;
alter table public.groups add constraint groups_created_by_fkey
  foreign key (created_by) references public.profiles on delete set null;
