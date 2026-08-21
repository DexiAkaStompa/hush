alter table public.profiles
drop constraint if exists profiles_username_check;

alter table public.profiles
add constraint profiles_username_check
check (
  username = lower(username)
  and username ~ '^[a-z0-9_]{3,24}$'
);

create or replace function public.handle_new_user()
returns trigger
security definer
set search_path = ''
language plpgsql
as $$
declare
  requested_username text;
  requested_display_name text;
begin
  requested_username := lower(trim(coalesce(
    new.raw_user_meta_data ->> 'username',
    split_part(coalesce(new.email, ''), '@', 1)
  )));

  if requested_username !~ '^[a-z0-9_]{3,24}$' then
    raise exception 'invalid_username';
  end if;

  requested_display_name := left(trim(coalesce(
    nullif(new.raw_user_meta_data ->> 'display_name', ''),
    requested_username
  )), 64);

  insert into public.profiles (id, username, display_name)
  values (new.id, requested_username, requested_display_name);
  return new;
end;
$$;

comment on column public.profiles.username is
'Login pubblico normalizzato. Supabase Auth usa internamente username@users.hush.invalid; nessuna email reale è richiesta.';
