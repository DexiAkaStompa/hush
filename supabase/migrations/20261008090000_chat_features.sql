-- Message lifecycle metadata and member-scoped reactions/pins.
alter table public.encrypted_messages add column if not exists updated_at timestamptz;

-- Keep lifecycle events flowing to the private conversation topic.
drop trigger if exists encrypted_messages_broadcast on public.encrypted_messages;
create trigger encrypted_messages_broadcast
after insert or update or delete on public.encrypted_messages
for each row execute function public.broadcast_encrypted_message();

create or replace function public.touch_encrypted_message_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
drop trigger if exists encrypted_messages_updated_at on public.encrypted_messages;
create trigger encrypted_messages_updated_at before update on public.encrypted_messages
for each row execute function public.touch_encrypted_message_updated_at();

create table if not exists public.message_reactions (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  message_id uuid not null references public.encrypted_messages(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  emoji text not null check (char_length(emoji) between 1 and 32),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, emoji)
);
create index if not exists message_reactions_conversation_idx on public.message_reactions(conversation_id, message_id);

create table if not exists public.message_pins (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  message_id uuid not null references public.encrypted_messages(id) on delete cascade,
  pinned_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (message_id, pinned_by)
);
create index if not exists message_pins_conversation_idx on public.message_pins(conversation_id, message_id);

create or replace function public.broadcast_message_extras() returns trigger security definer set search_path = '' language plpgsql as $$
declare message_row public.encrypted_messages;
begin select * into message_row from public.encrypted_messages where id = coalesce(new.message_id, old.message_id); perform realtime.broadcast_changes('conversation:' || message_row.conversation_id::text, 'EXTRAS', 'EXTRAS', 'encrypted_messages', 'public', message_row, message_row); return coalesce(new, old); end; $$;
drop trigger if exists message_reactions_extras_broadcast on public.message_reactions;
create trigger message_reactions_extras_broadcast after insert or update or delete on public.message_reactions for each row execute function public.broadcast_message_extras();
drop trigger if exists message_pins_extras_broadcast on public.message_pins;
create trigger message_pins_extras_broadcast after insert or update or delete on public.message_pins for each row execute function public.broadcast_message_extras();

create table if not exists public.conversation_reads (
  user_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (user_id, conversation_id)
);

alter table public.message_reactions enable row level security;
alter table public.message_pins enable row level security;
alter table public.conversation_reads enable row level security;

create policy "members can read message reactions" on public.message_reactions for select to authenticated
using (public.is_conversation_member(conversation_id));
create policy "members can read message pins" on public.message_pins for select to authenticated
using (public.is_conversation_member(conversation_id));
create policy "users can read own conversation reads" on public.conversation_reads for select to authenticated
using (user_id = (select auth.uid()));

create or replace function public.mark_conversation_read(p_conversation_id uuid, p_read_at timestamptz default now())
returns public.conversation_reads language plpgsql security definer set search_path = '' as $$
declare result public.conversation_reads;
begin
  if not public.is_conversation_member(p_conversation_id) then raise exception 'read_state_forbidden' using errcode = '42501'; end if;
  insert into public.conversation_reads(user_id, conversation_id, last_read_at)
  values ((select auth.uid()), p_conversation_id, least(coalesce(p_read_at, now()), now()))
  on conflict (user_id, conversation_id) do update set last_read_at = greatest(public.conversation_reads.last_read_at, excluded.last_read_at)
  returning * into result;
  return result;
end;
$$;

create or replace function public.get_conversation_unreads(p_conversation_ids uuid[])
returns table(conversation_id uuid, unread_count bigint, last_read_at timestamptz)
language sql security definer set search_path = '' as $$
  select c.id,
    (select count(*) from public.encrypted_messages m
      where m.conversation_id = c.id and m.sender_id <> (select auth.uid())
        and m.created_at > coalesce(r.last_read_at, '-infinity'::timestamptz)),
    r.last_read_at
  from public.conversations c
  left join public.conversation_reads r on r.conversation_id = c.id and r.user_id = (select auth.uid())
  where c.id = any(coalesce(p_conversation_ids, '{}'::uuid[]))
    and public.is_conversation_member(c.id)
  limit 500;
$$;

create or replace function public.update_encrypted_message(
  p_message_id uuid, p_nonce text, p_ciphertext text, p_aad_json jsonb
) returns public.encrypted_messages
language plpgsql security definer set search_path = '' as $$
declare result public.encrypted_messages;
begin
  update public.encrypted_messages m
     set nonce = p_nonce, ciphertext = p_ciphertext, aad_json = coalesce(p_aad_json, '{}'::jsonb)
   where m.id = p_message_id and m.sender_id = (select auth.uid())
     and public.is_conversation_member(m.conversation_id)
     and exists (select 1 from public.conversations c where c.id = m.conversation_id and (c.send_permission = 'members' or public.is_space_admin(c.space_id)))
  returning m.* into result;
  if result.id is null then raise exception 'message_edit_forbidden' using errcode = '42501'; end if;
  return result;
end;
$$;

create or replace function public.delete_encrypted_message(p_message_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare removed integer;
begin
  delete from public.encrypted_messages m
   where m.id = p_message_id and m.sender_id = (select auth.uid())
     and public.is_conversation_member(m.conversation_id);
  get diagnostics removed = row_count;
  if removed = 0 then raise exception 'message_delete_forbidden' using errcode = '42501'; end if;
  return true;
end;
$$;

create or replace function public.toggle_message_reaction(p_message_id uuid, p_emoji text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare conversation uuid; existed boolean;
begin
  if p_emoji is null or char_length(p_emoji) < 1 or char_length(p_emoji) > 32 then raise exception 'invalid_reaction'; end if;
  select conversation_id into conversation from public.encrypted_messages where id = p_message_id;
  if conversation is null or not public.is_conversation_member(conversation) then raise exception 'reaction_forbidden' using errcode = '42501'; end if;
  perform 1 from public.encrypted_messages where id = p_message_id for update;
  select exists(select 1 from public.message_reactions where message_id = p_message_id and user_id = (select auth.uid()) and emoji = p_emoji) into existed;
  if existed then delete from public.message_reactions where message_id = p_message_id and user_id = (select auth.uid()) and emoji = p_emoji;
  else insert into public.message_reactions(conversation_id, message_id, user_id, emoji) values (conversation, p_message_id, (select auth.uid()), p_emoji); end if;
  return not existed;
end;
$$;

create or replace function public.toggle_message_pin(p_message_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare conversation uuid; existed boolean;
begin
  select conversation_id into conversation from public.encrypted_messages where id = p_message_id;
  if conversation is null or not public.is_conversation_member(conversation) then raise exception 'pin_forbidden' using errcode = '42501'; end if;
  perform 1 from public.encrypted_messages where id = p_message_id for update;
  select exists(select 1 from public.message_pins where message_id = p_message_id) into existed;
  if existed then delete from public.message_pins where message_id = p_message_id;
  else insert into public.message_pins(conversation_id, message_id, pinned_by) values (conversation, p_message_id, (select auth.uid())); end if;
  return not existed;
end;
$$;

grant execute on function public.update_encrypted_message(uuid, text, text, jsonb) to authenticated;
grant execute on function public.delete_encrypted_message(uuid) to authenticated;
grant execute on function public.toggle_message_reaction(uuid, text) to authenticated;
grant execute on function public.toggle_message_pin(uuid) to authenticated;
grant execute on function public.mark_conversation_read(uuid, timestamptz) to authenticated;
grant execute on function public.get_conversation_unreads(uuid[]) to authenticated;
revoke execute on function public.update_encrypted_message(uuid, text, text, jsonb) from public, anon;
revoke execute on function public.delete_encrypted_message(uuid) from public, anon;
revoke execute on function public.toggle_message_reaction(uuid, text) from public, anon;
revoke execute on function public.toggle_message_pin(uuid) from public, anon;
revoke execute on function public.mark_conversation_read(uuid, timestamptz) from public, anon;
revoke execute on function public.get_conversation_unreads(uuid[]) from public, anon;

-- Return one encrypted preview per room rather than fetching full histories.
create index if not exists encrypted_messages_history_idx on public.encrypted_messages(conversation_id, created_at desc, id desc);
create or replace function public.get_latest_encrypted_messages(p_conversation_ids uuid[])
returns setof public.encrypted_messages language sql security definer set search_path = '' as $$
 select distinct on (m.conversation_id) m.* from public.encrypted_messages m
 where m.conversation_id = any(p_conversation_ids[1:500]) and public.is_conversation_member(m.conversation_id)
 order by m.conversation_id, m.created_at desc, m.id desc;
$$;
revoke execute on function public.get_latest_encrypted_messages(uuid[]) from public, anon;
grant execute on function public.get_latest_encrypted_messages(uuid[]) to authenticated;

grant select on public.message_reactions, public.message_pins, public.conversation_reads to authenticated;

grant select, insert on public.encrypted_messages to authenticated;
