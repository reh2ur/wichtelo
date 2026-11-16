-- Giver reads recipient's open group wishes (issue #209, wishlist 2/3).
--
-- Only the giver of the wish owner, in the wish's group, and only open wishes
-- linked to that group. Access follows the CURRENT assignment row: re-draw
-- overwrites it, removing a member cascades it, a ghosted receiver
-- (profile_id null) matches no wish owner. Admins get nothing extra: the
-- policy requires the caller to BE the giver.
--
-- Security definer helper because the caller cannot read the receiver's
-- membership row through memberships RLS (own row or admin only).

create function public.is_giver_of_wish(p_group_id uuid, p_owner_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.assignments a
      join public.memberships g on g.id = a.giver_id
      join public.memberships r on r.id = a.receiver_id
     where a.group_id = p_group_id
       and g.group_id = p_group_id
       and r.group_id = p_group_id
       and g.profile_id = auth.uid()
       and r.profile_id = p_owner_id
  );
$$;

revoke all on function public.is_giver_of_wish(uuid, uuid) from public, anon;
grant execute on function public.is_giver_of_wish(uuid, uuid) to authenticated;

create policy "wishes: giver can read recipient's open group wishes"
  on public.wishes for select to authenticated
  using (
    status = 'open'
    and group_id is not null
    and public.is_giver_of_wish(group_id, profile_id)
  );
