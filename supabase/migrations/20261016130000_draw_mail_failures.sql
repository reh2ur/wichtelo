-- Persist draw-mail partial failures server-side (issue #106).
--
-- Resend-failure state used to live in the admin's sessionStorage only: closing
-- the tab or switching device lost the resend button. One row per group holds
-- the failed/total counts of the latest mail send, tagged with the draw_version
-- it belongs to. Readers ignore rows whose draw_version differs from the
-- group's current one, so a re-draw resets the warning even if the new send
-- never got to write. Resend recomputes the recipient set from the draw, so
-- counts are all that is stored (no recipient addresses).
--
-- Visibility: group admins read via user JWT. All writes go through the
-- service-role-only RPC below (or service-role deletes).

create table public.draw_mail_failures (
  group_id uuid primary key references public.groups(id) on delete cascade,
  draw_version integer not null,
  failed integer not null check (failed > 0),
  total integer not null check (total >= failed),
  updated_at timestamptz not null default now()
);

alter table public.draw_mail_failures enable row level security;

create policy "draw_mail_failures: admins can read"
  on public.draw_mail_failures for select
  using (public.is_admin(group_id));

revoke all on public.draw_mail_failures from anon, authenticated;
grant select on public.draw_mail_failures to authenticated;

-- Records the outcome of a draw/re-draw/resend mail send.
--   failed > 0: upsert the warning.
--   failed = 0: clear it.
-- Never regresses to an older draw: a slow resend of draw N must not clobber
-- the row of draw N+1 (writes only when the stored draw_version is <= p_draw_version).
create function public.record_draw_mail_result(
  p_group_id uuid,
  p_draw_version integer,
  p_failed integer,
  p_total integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_failed > 0 then
    insert into public.draw_mail_failures (group_id, draw_version, failed, total)
    select p_group_id, p_draw_version, p_failed, greatest(p_total, p_failed)
      from public.groups where id = p_group_id
    on conflict (group_id) do update
      set draw_version = excluded.draw_version,
          failed = excluded.failed,
          total = excluded.total,
          updated_at = now()
      where public.draw_mail_failures.draw_version <= excluded.draw_version;
  else
    delete from public.draw_mail_failures
     where group_id = p_group_id and draw_version <= p_draw_version;
  end if;
end;
$$;

revoke all on function public.record_draw_mail_result(uuid, integer, integer, integer)
  from public, anon, authenticated;
grant execute on function public.record_draw_mail_result(uuid, integer, integer, integer)
  to service_role;
