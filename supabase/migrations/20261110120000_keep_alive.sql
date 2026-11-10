-- Keep-alive RPC for the supabase-keep-alive GitHub workflow.
--
-- The old ping (anon read of `groups`, RLS -> 0 rows) still got HTTP 200 daily,
-- yet staging got a "project will be paused" mail. This runs a real SQL
-- statement instead. No table access, no data returned, security invoker.

create function public.keep_alive()
returns integer
language sql
stable
security invoker
set search_path = ''
as $$
  select 1;
$$;

revoke all on function public.keep_alive() from public;
grant execute on function public.keep_alive() to anon, authenticated, service_role;
