create extension if not exists pgcrypto;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique check (char_length(username) between 3 and 32),
  display_name text not null check (char_length(display_name) between 1 and 64),
  avatar_color text not null default '#73b7ff' check (avatar_color ~ '^#[0-9a-fA-F]{6}$'),
  created_at timestamptz not null default now()
);

create table public.devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  label text not null check (char_length(label) between 1 and 80),
  signature_public_key text not null,
  hpke_public_key text not null,
  credential jsonb not null,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
create index devices_user_id_idx on public.devices(user_id);

create table public.spaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  owner_id uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create table public.space_members (
  space_id uuid not null references public.spaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'admin', 'member')),
  joined_at timestamptz not null default now(),
  primary key (space_id, user_id)
);
create index space_members_user_idx on public.space_members(user_id, space_id);

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  space_id uuid references public.spaces(id) on delete cascade,
  kind text not null check (kind in ('channel', 'group_dm')),
  name text not null check (char_length(name) between 1 and 80),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  check ((kind = 'channel' and space_id is not null) or (kind = 'group_dm' and space_id is null))
);
create index conversations_space_idx on public.conversations(space_id);

create table public.conversation_members (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  primary key (conversation_id, user_id)
);
create index conversation_members_user_idx on public.conversation_members(user_id, conversation_id) where left_at is null;

create table public.encrypted_messages (
  id uuid primary key,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null references auth.users(id),
  algorithm text not null check (algorithm in ('AES-256-GCM', 'MLS-1.0')),
  key_epoch bigint not null default 0 check (key_epoch >= 0),
  nonce text not null check (char_length(nonce) between 8 and 128),
  ciphertext text not null check (char_length(ciphertext) between 1 and 49152),
  aad_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index encrypted_messages_timeline_idx on public.encrypted_messages(conversation_id, created_at desc, id);

alter table public.profiles enable row level security;
alter table public.devices enable row level security;
alter table public.spaces enable row level security;
alter table public.space_members enable row level security;
alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.encrypted_messages enable row level security;

create or replace function public.is_space_member(requested_space uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.space_members
    where space_id = requested_space and user_id = (select auth.uid())
  );
$$;

create or replace function public.is_conversation_member(requested_conversation uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.conversation_members
    where conversation_id = requested_conversation
      and user_id = (select auth.uid())
      and left_at is null
  );
$$;

create or replace function public.can_access_realtime_topic(requested_topic text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if requested_topic !~ '^conversation:[0-9a-fA-F-]{36}$' then
    return false;
  end if;
  return public.is_conversation_member(split_part(requested_topic, ':', 2)::uuid);
exception when invalid_text_representation then
  return false;
end;
$$;

grant execute on function public.is_space_member(uuid) to authenticated;
grant execute on function public.is_conversation_member(uuid) to authenticated;
grant execute on function public.can_access_realtime_topic(text) to authenticated;

create policy "profiles are visible to authenticated users"
on public.profiles for select to authenticated using (true);
create policy "users update their own profile"
on public.profiles for update to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

create policy "users manage their own devices"
on public.devices for all to authenticated
using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create policy "members can read spaces"
on public.spaces for select to authenticated using (public.is_space_member(id));
create policy "authenticated users can create spaces"
on public.spaces for insert to authenticated with check ((select auth.uid()) = owner_id);
create policy "owners can update spaces"
on public.spaces for update to authenticated using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);

create policy "members can read space memberships"
on public.space_members for select to authenticated using (public.is_space_member(space_id));

create policy "members can read conversations"
on public.conversations for select to authenticated using (public.is_conversation_member(id));
create policy "space members can create channels"
on public.conversations for insert to authenticated
with check ((select auth.uid()) = created_by and (space_id is null or public.is_space_member(space_id)));

create policy "members can read conversation memberships"
on public.conversation_members for select to authenticated using (public.is_conversation_member(conversation_id));

create policy "members can read encrypted messages"
on public.encrypted_messages for select to authenticated using (public.is_conversation_member(conversation_id));
create policy "members can insert encrypted messages"
on public.encrypted_messages for insert to authenticated
with check ((select auth.uid()) = sender_id and public.is_conversation_member(conversation_id));

create policy "members can receive private realtime events"
on realtime.messages for select to authenticated
using (
  realtime.messages.extension in ('broadcast', 'presence')
  and public.can_access_realtime_topic((select realtime.topic()))
);
create policy "members can send private realtime events"
on realtime.messages for insert to authenticated
with check (
  realtime.messages.extension in ('broadcast', 'presence')
  and public.can_access_realtime_topic((select realtime.topic()))
);

create or replace function public.broadcast_encrypted_message()
returns trigger
security definer
set search_path = ''
language plpgsql
as $$
begin
  perform realtime.broadcast_changes(
    'conversation:' || coalesce(new.conversation_id, old.conversation_id)::text,
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

create trigger encrypted_messages_broadcast
after insert or update or delete on public.encrypted_messages
for each row execute function public.broadcast_encrypted_message();

create or replace function public.bootstrap_space_membership()
returns trigger
security definer
set search_path = ''
language plpgsql
as $$
begin
  insert into public.space_members (space_id, user_id, role)
  values (new.id, new.owner_id, 'owner')
  on conflict do nothing;
  return new;
end;
$$;

create trigger on_space_created
after insert on public.spaces
for each row execute function public.bootstrap_space_membership();

create or replace function public.bootstrap_conversation_membership()
returns trigger
security definer
set search_path = ''
language plpgsql
as $$
begin
  if new.space_id is null then
    insert into public.conversation_members (conversation_id, user_id)
    values (new.id, new.created_by)
    on conflict do nothing;
  else
    insert into public.conversation_members (conversation_id, user_id)
    select new.id, member.user_id
    from public.space_members as member
    where member.space_id = new.space_id
    on conflict do nothing;
  end if;
  return new;
end;
$$;

create trigger on_conversation_created
after insert on public.conversations
for each row execute function public.bootstrap_conversation_membership();

create or replace function public.handle_new_user()
returns trigger
security definer
set search_path = ''
language plpgsql
as $$
declare
  base_username text;
begin
  base_username := regexp_replace(split_part(coalesce(new.email, new.id::text), '@', 1), '[^a-zA-Z0-9_]', '', 'g');
  if char_length(base_username) < 3 then base_username := 'user'; end if;
  insert into public.profiles (id, username, display_name)
  values (
    new.id,
    left(base_username, 23) || '_' || left(replace(new.id::text, '-', ''), 8),
    left(coalesce(new.raw_user_meta_data ->> 'display_name', split_part(coalesce(new.email, 'Nuovo utente'), '@', 1)), 64)
  );
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();
