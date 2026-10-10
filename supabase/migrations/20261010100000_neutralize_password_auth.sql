-- Neutralize password auth (issue #15).
--
-- App is passwordless (email OTP / magic link only), but GoTrue's password
-- provider is reachable by anyone holding the publishable key
-- (POST /auth/v1/signup {email,password}). That allowed pre-registering a
-- victim's address with an attacker-known password (account pre-hijack) and
-- signing up the super-admin address before the operator.
--
-- Can't reject non-empty passwords: GoTrue itself creates OTP / magic-link
-- users with a random temporary password, so every invite signup would fail.
-- Instead blank any password written to auth.users. Password login against an
-- empty hash can never succeed, whoever chose the password. Trigger lives in
-- the DB, so it applies on every stack (local, staging, live) once the
-- migration is pushed - no `supabase config push` needed.

create or replace function public.blank_auth_password()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(new.encrypted_password, '') <> '' then
    new.encrypted_password := '';
  end if;
  return new;
end;
$$;

revoke all on function public.blank_auth_password() from public, anon, authenticated;

drop trigger if exists blank_auth_password on auth.users;
create trigger blank_auth_password
  before insert or update of encrypted_password on auth.users
  for each row execute function public.blank_auth_password();
