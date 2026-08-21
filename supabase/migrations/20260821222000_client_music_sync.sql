-- Client-side room music. Supabase stores and broadcasts playback state only;
-- every Hush client fetches the HTTPS audio source directly.
-- Run after 20260821221000_invite_pgcrypto_schema_fix.sql.

create table if not exists public.conversation_music_state (
  conversation_id uuid primary key references public.conversations(id) on delete cascade,
  source_url text check (source_url is null or char_length(source_url) between 8 and 2048),
  title text check (title is null or char_length(title) between 1 and 200),
  is_playing boolean not null default false,
  position_seconds double precision not null default 0 check (position_seconds between 0 and 604800),
  anchor_at timestamptz not null default now(),
  revision bigint not null default 0 check (revision >= 0),
  updated_by uuid not null references auth.users(id),
  updated_at timestamptz not null default now()
);

alter table public.conversation_music_state enable row level security;

drop policy if exists "members read conversation music" on public.conversation_music_state;
create policy "members read conversation music"
on public.conversation_music_state for select to authenticated
using (public.is_conversation_member(conversation_id));

grant select on public.conversation_music_state to authenticated;
revoke insert, update, delete on public.conversation_music_state from authenticated;

create or replace function public.set_conversation_music_state(
  p_conversation_id uuid,
  p_source_url text,
  p_title text,
  p_is_playing boolean,
  p_position_seconds double precision
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  clean_url text := nullif(trim(p_source_url), '');
  clean_title text := nullif(trim(p_title), '');
  next_state public.conversation_music_state%rowtype;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if not public.is_conversation_member(p_conversation_id) then raise exception 'not_conversation_member'; end if;
  if clean_url is not null and (
    clean_url !~ '^https://[^[:space:]]+$'
    or char_length(clean_url) > 2048
    or clean_url ~* '^https://[^/]*@'
    or clean_url ~* '^https://(localhost|[^/]*\.localhost|0\.0\.0\.0|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2[0-9]|3[0-1])\.|\[?::1\]?)'
    or clean_url ~* '^https://\[(fc|fd|fe8|fe9|fea|feb)[0-9a-f]*:'
  ) then raise exception 'invalid_music_url'; end if;
  if clean_url is not null and (clean_title is null or char_length(clean_title) > 200) then
    raise exception 'invalid_music_title';
  end if;
  if p_position_seconds is null or p_position_seconds < 0 or p_position_seconds > 604800 then
    raise exception 'invalid_music_position';
  end if;

  insert into public.conversation_music_state (
    conversation_id,
    source_url,
    title,
    is_playing,
    position_seconds,
    anchor_at,
    revision,
    updated_by,
    updated_at
  ) values (
    p_conversation_id,
    clean_url,
    clean_title,
    clean_url is not null and p_is_playing,
    case when clean_url is null then 0 else p_position_seconds end,
    now(),
    1,
    auth.uid(),
    now()
  )
  on conflict (conversation_id) do update set
    source_url = excluded.source_url,
    title = excluded.title,
    is_playing = excluded.is_playing,
    position_seconds = excluded.position_seconds,
    anchor_at = excluded.anchor_at,
    revision = public.conversation_music_state.revision + 1,
    updated_by = excluded.updated_by,
    updated_at = excluded.updated_at
  returning * into next_state;

  return to_jsonb(next_state);
end;
$$;

revoke all on function public.set_conversation_music_state(uuid, text, text, boolean, double precision) from public;
grant execute on function public.set_conversation_music_state(uuid, text, text, boolean, double precision) to authenticated;

create or replace function public.can_access_realtime_topic(requested_topic text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if requested_topic !~ '^(conversation|call|music):[0-9a-fA-F-]{36}$' then
    return false;
  end if;
  return public.is_conversation_member(split_part(requested_topic, ':', 2)::uuid);
exception when invalid_text_representation then
  return false;
end;
$$;

grant execute on function public.can_access_realtime_topic(text) to authenticated;

create or replace function public.broadcast_conversation_music_state()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform realtime.broadcast_changes(
    'music:' || coalesce(new.conversation_id, old.conversation_id)::text,
    tg_op,
    tg_op,
    tg_table_name,
    tg_table_schema,
    new,
    old
  );
  return null;
end;
$$;

drop trigger if exists conversation_music_state_broadcast on public.conversation_music_state;
create trigger conversation_music_state_broadcast
after insert or update or delete on public.conversation_music_state
for each row execute function public.broadcast_conversation_music_state();

notify pgrst, 'reload schema';
