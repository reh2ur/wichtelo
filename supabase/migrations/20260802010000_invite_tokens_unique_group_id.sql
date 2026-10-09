-- Enforce "one active token per group" invariant (see schema comment on
-- invite_tokens). Without this, a race in getOrCreateToken() can create
-- multiple token rows for the same group.

-- Groups affected by the race already have duplicate rows in the wild —
-- keep the oldest token per group (the one that may already be shared)
-- and drop the rest before the constraint can be added.
delete from public.invite_tokens a using public.invite_tokens b
where a.group_id = b.group_id
  and (a.created_at, a.id) > (b.created_at, b.id);

alter table public.invite_tokens
  add constraint invite_tokens_group_id_key unique (group_id);
