-- Distinguish the two ways an admin can learn about a pairing (#223):
--   assignment = the lookup action revealed whom a member gives to
--   identity   = the distribution view revealed the real name behind a
--                pseudonym ("Person A")
-- Existing rows are assignment lookups.

alter table public.assignment_lookups
  add column kind text not null default 'assignment'
  constraint assignment_lookups_kind_check
    check (kind in ('assignment', 'identity'));
