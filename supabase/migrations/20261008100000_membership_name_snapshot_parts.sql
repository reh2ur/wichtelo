-- Store first/last name separately in the membership snapshot so the display
-- name does not change after account deletion (name_snapshot was re-split on
-- the first space, turning "Anna Maria Müller" into "Anna" + "Maria Müller").
alter table public.memberships
  add column first_name_snapshot text,
  add column last_name_snapshot text;

update public.memberships m
set first_name_snapshot = p.first_name,
    last_name_snapshot = p.last_name
from public.profiles p
where m.profile_id = p.id;
