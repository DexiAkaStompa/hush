-- Dedicated voice channels and isolated Realtime topics for WebRTC calls.
-- Run after 20260821210000_profile_repair.sql.

alter table public.conversations
drop constraint if exists conversations_kind_check;

alter table public.conversations
drop constraint if exists conversations_check;

alter table public.conversations
drop constraint if exists conversations_scope_check;

alter table public.conversations
add constraint conversations_kind_check
check (kind in ('channel', 'voice_channel', 'group_dm'));

alter table public.conversations
add constraint conversations_scope_check
check (
  (kind in ('channel', 'voice_channel') and space_id is not null)
  or (kind = 'group_dm' and space_id is null)
);

create or replace function public.can_access_realtime_topic(requested_topic text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if requested_topic !~ '^(conversation|call):[0-9a-fA-F-]{36}$' then
    return false;
  end if;
  return public.is_conversation_member(split_part(requested_topic, ':', 2)::uuid);
exception when invalid_text_representation then
  return false;
end;
$$;

grant execute on function public.can_access_realtime_topic(text) to authenticated;

create or replace function public.create_space_voice_channel(p_space_id uuid, p_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  clean_name text := trim(p_name);
  new_conversation_id uuid;
begin
  if not public.is_space_admin(p_space_id) then raise exception 'not_space_admin'; end if;
  if char_length(clean_name) not between 1 and 80 then raise exception 'invalid_channel_name'; end if;
  if exists (
    select 1 from public.conversations
    where space_id = p_space_id and lower(name) = lower(clean_name)
  ) then raise exception 'channel_already_exists'; end if;

  insert into public.conversations(space_id, kind, name, created_by)
  values (p_space_id, 'voice_channel', clean_name, auth.uid())
  returning id into new_conversation_id;
  return new_conversation_id;
end;
$$;

create or replace function public.create_space_with_general(p_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  clean_name text := trim(p_name);
  new_space_id uuid;
begin
  if current_user_id is null then raise exception 'not_authenticated'; end if;
  if char_length(clean_name) not between 1 and 80 then raise exception 'invalid_space_name'; end if;

  insert into public.spaces(name, owner_id)
  values (clean_name, current_user_id)
  returning id into new_space_id;

  insert into public.conversations(space_id, kind, name, created_by)
  values
    (new_space_id, 'channel', 'generale', current_user_id),
    (new_space_id, 'voice_channel', 'Lounge', current_user_id);

  return new_space_id;
end;
$$;

create or replace function public.delete_space_channel(p_conversation_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare selected_space_id uuid;
begin
  select space_id into selected_space_id
  from public.conversations
  where id = p_conversation_id and kind in ('channel', 'voice_channel');
  if selected_space_id is null or not public.is_space_admin(selected_space_id) then
    raise exception 'not_space_admin';
  end if;
  delete from public.conversations where id = p_conversation_id;
end;
$$;

grant execute on function public.create_space_voice_channel(uuid, text) to authenticated;
grant execute on function public.create_space_with_general(text) to authenticated;
grant execute on function public.delete_space_channel(uuid) to authenticated;

notify pgrst, 'reload schema';
