-- Repairs accounts created before the profile trigger/migrations were applied.
-- Safe to run after the initial, auth and functional MVP migrations.
create or replace function public.ensure_profile(p_username text, p_display_name text)
returns public.profiles
security definer
set search_path = ''
language plpgsql
as $$
declare
  current_user_id uuid := auth.uid();
  clean_username text := lower(trim(coalesce(p_username, '')));
  clean_display_name text := left(trim(coalesce(p_display_name, 'Utente')), 64);
  fallback_username text;
  profile_row public.profiles;
begin
  if current_user_id is null then raise exception 'not_authenticated'; end if;

  select * into profile_row from public.profiles where id = current_user_id;
  if found then return profile_row; end if;

  if clean_username !~ '^[a-z0-9_]{3,24}$' then
    clean_username := 'user_' || left(replace(current_user_id::text, '-', ''), 8);
  end if;
  if char_length(clean_display_name) = 0 then clean_display_name := clean_username; end if;

  if exists (select 1 from public.profiles where username = clean_username) then
    fallback_username := 'user_' || left(replace(current_user_id::text, '-', ''), 8);
    clean_username := left(fallback_username, 24);
  end if;

  insert into public.profiles (id, username, display_name)
  values (current_user_id, clean_username, clean_display_name)
  returning * into profile_row;
  return profile_row;
end;
$$;

grant execute on function public.ensure_profile(text, text) to authenticated;
notify pgrst, 'reload schema';
