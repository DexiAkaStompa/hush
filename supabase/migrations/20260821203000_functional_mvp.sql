-- Hush functional MVP: server/channel/DM lifecycle, invitations and E2EE key envelopes.
-- Run after 20260821143000_initial.sql and 20260821170000_username_password_auth.sql.

create table if not exists public.space_invites (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces(id) on delete cascade,
  token_hash text not null unique,
  created_by uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null default (now() + interval '7 days'),
  max_uses integer not null default 25 check (max_uses between 1 and 1000),
  use_count integer not null default 0 check (use_count >= 0),
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists space_invites_space_idx on public.space_invites(space_id);

create table if not exists public.conversation_key_envelopes (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  recipient_device_id uuid not null references public.devices(id) on delete cascade,
  sender_device_id uuid not null references public.devices(id) on delete cascade,
  key_epoch bigint not null default 0 check (key_epoch >= 0),
  ephemeral_public_key jsonb not null,
  nonce text not null check (char_length(nonce) between 8 and 128),
  ciphertext text not null check (char_length(ciphertext) between 8 and 2048),
  created_at timestamptz not null default now(),
  primary key (conversation_id, recipient_device_id, key_epoch)
);

create table if not exists public.conversation_key_requests (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  requester_device_id uuid not null references public.devices(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (conversation_id, requester_device_id)
);

alter table public.space_invites enable row level security;
alter table public.conversation_key_envelopes enable row level security;
alter table public.conversation_key_requests enable row level security;

create or replace function public.is_space_admin(requested_space uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.space_members
    where space_id = requested_space
      and user_id = (select auth.uid())
      and role in ('owner', 'admin')
  );
$$;

grant execute on function public.is_space_admin(uuid) to authenticated;

drop policy if exists "conversation peers can read device public keys" on public.devices;
create policy "conversation peers can read device public keys"
on public.devices for select to authenticated
using (
  revoked_at is null and (
    user_id = (select auth.uid())
    or exists (
      select 1
      from public.conversation_members mine
      join public.conversation_members theirs
        on theirs.conversation_id = mine.conversation_id
      where mine.user_id = (select auth.uid())
        and mine.left_at is null
        and theirs.user_id = devices.user_id
        and theirs.left_at is null
    )
    or exists (
      select 1
      from public.space_members mine
      join public.space_members theirs on theirs.space_id = mine.space_id
      where mine.user_id = (select auth.uid())
        and theirs.user_id = devices.user_id
    )
  )
);

create policy "admins can read their invites"
on public.space_invites for select to authenticated
using (public.is_space_admin(space_id));

create policy "devices read their key envelopes"
on public.conversation_key_envelopes for select to authenticated
using (
  exists (
    select 1 from public.devices
    where devices.id = recipient_device_id
      and devices.user_id = (select auth.uid())
      and devices.revoked_at is null
  )
);

create policy "members create key envelopes"
on public.conversation_key_envelopes for insert to authenticated
with check (
  public.is_conversation_member(conversation_id)
  and exists (
    select 1 from public.devices sender
    where sender.id = sender_device_id
      and sender.user_id = (select auth.uid())
      and sender.revoked_at is null
  )
  and exists (
    select 1
    from public.devices recipient
    join public.conversation_members member on member.user_id = recipient.user_id
    where recipient.id = recipient_device_id
      and recipient.revoked_at is null
      and member.conversation_id = conversation_key_envelopes.conversation_id
      and member.left_at is null
  )
);

create policy "members read key requests"
on public.conversation_key_requests for select to authenticated
using (public.is_conversation_member(conversation_id));

create policy "devices request conversation keys"
on public.conversation_key_requests for insert to authenticated
with check (
  public.is_conversation_member(conversation_id)
  and exists (
    select 1 from public.devices
    where devices.id = requester_device_id
      and devices.user_id = (select auth.uid())
      and devices.revoked_at is null
  )
);

create or replace function public.clear_fulfilled_key_request()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.conversation_key_requests
  where conversation_id = new.conversation_id
    and requester_device_id = new.recipient_device_id;
  return new;
end;
$$;

drop trigger if exists on_key_envelope_created on public.conversation_key_envelopes;
create trigger on_key_envelope_created
after insert or update on public.conversation_key_envelopes
for each row execute function public.clear_fulfilled_key_request();

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
  values (new_space_id, 'channel', 'generale', current_user_id);

  return new_space_id;
end;
$$;

create or replace function public.create_space_channel(p_space_id uuid, p_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  clean_name text := lower(regexp_replace(trim(p_name), '[^a-zA-Z0-9_-]+', '-', 'g'));
  new_conversation_id uuid;
begin
  if not public.is_space_admin(p_space_id) then raise exception 'not_space_admin'; end if;
  if char_length(clean_name) not between 1 and 80 then raise exception 'invalid_channel_name'; end if;
  if exists (select 1 from public.conversations where space_id = p_space_id and lower(name) = clean_name) then
    raise exception 'channel_already_exists';
  end if;

  insert into public.conversations(space_id, kind, name, created_by)
  values (p_space_id, 'channel', clean_name, auth.uid())
  returning id into new_conversation_id;
  return new_conversation_id;
end;
$$;

create or replace function public.create_group_dm(p_name text, p_usernames text[])
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  clean_name text := trim(p_name);
  requested_count integer;
  matched_count integer;
  new_conversation_id uuid;
begin
  if current_user_id is null then raise exception 'not_authenticated'; end if;
  if char_length(clean_name) not between 1 and 80 then raise exception 'invalid_group_name'; end if;
  select count(distinct lower(trim(item.value))) into requested_count
  from unnest(p_usernames) as item(value)
  where trim(item.value) <> '';
  if requested_count < 1 or requested_count > 24 then raise exception 'invalid_member_count'; end if;
  select count(*) into matched_count
  from public.profiles
  where username in (
    select lower(trim(item.value)) from unnest(p_usernames) as item(value)
  );
  if matched_count <> requested_count then raise exception 'unknown_username'; end if;

  insert into public.conversations(space_id, kind, name, created_by)
  values (null, 'group_dm', clean_name, current_user_id)
  returning id into new_conversation_id;

  insert into public.conversation_members(conversation_id, user_id)
  select new_conversation_id, id from public.profiles
  where username in (
    select lower(trim(item.value)) from unnest(p_usernames) as item(value)
  )
  on conflict do nothing;

  return new_conversation_id;
end;
$$;

create or replace function public.create_space_invite(p_space_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  raw_token text := encode(extensions.gen_random_bytes(24), 'hex');
begin
  if not public.is_space_admin(p_space_id) then raise exception 'not_space_admin'; end if;
  insert into public.space_invites(space_id, token_hash, created_by)
  values (p_space_id, encode(extensions.digest(raw_token, 'sha256'), 'hex'), auth.uid());
  return raw_token;
end;
$$;

create or replace function public.join_space_with_invite(p_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  selected_invite public.space_invites%rowtype;
begin
  if current_user_id is null then raise exception 'not_authenticated'; end if;
  select * into selected_invite
  from public.space_invites
  where token_hash = encode(extensions.digest(trim(p_token), 'sha256'), 'hex')
    and revoked_at is null
    and expires_at > now()
    and use_count < max_uses
  for update;
  if selected_invite.id is null then raise exception 'invalid_or_expired_invite'; end if;

  insert into public.space_members(space_id, user_id, role)
  values (selected_invite.space_id, current_user_id, 'member')
  on conflict do nothing;

  insert into public.conversation_members(conversation_id, user_id)
  select id, current_user_id from public.conversations
  where space_id = selected_invite.space_id
  on conflict do nothing;

  insert into public.conversation_key_requests(conversation_id, requester_device_id)
  select conversation.id, device.id
  from public.conversations conversation
  cross join public.devices device
  where conversation.space_id = selected_invite.space_id
    and device.user_id = current_user_id
    and device.revoked_at is null
  on conflict do nothing;

  update public.space_invites set use_count = use_count + 1 where id = selected_invite.id;
  return selected_invite.space_id;
end;
$$;

create or replace function public.leave_space(p_space_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.spaces where id = p_space_id and owner_id = auth.uid()) then
    raise exception 'owner_cannot_leave';
  end if;
  update public.conversation_members member
  set left_at = now()
  from public.conversations conversation
  where member.conversation_id = conversation.id
    and conversation.space_id = p_space_id
    and member.user_id = auth.uid();
  delete from public.space_members where space_id = p_space_id and user_id = auth.uid();
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
  select space_id into selected_space_id from public.conversations where id = p_conversation_id and kind = 'channel';
  if selected_space_id is null or not public.is_space_admin(selected_space_id) then raise exception 'not_space_admin'; end if;
  delete from public.conversations where id = p_conversation_id;
end;
$$;

create or replace function public.delete_owned_space(p_space_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.spaces
    where id = p_space_id and owner_id = auth.uid()
  ) then raise exception 'not_space_owner'; end if;
  delete from public.spaces where id = p_space_id;
end;
$$;

grant execute on function public.create_space_with_general(text) to authenticated;
grant execute on function public.create_space_channel(uuid, text) to authenticated;
grant execute on function public.create_group_dm(text, text[]) to authenticated;
grant execute on function public.create_space_invite(uuid) to authenticated;
grant execute on function public.join_space_with_invite(text) to authenticated;
grant execute on function public.leave_space(uuid) to authenticated;
grant execute on function public.delete_space_channel(uuid) to authenticated;
grant execute on function public.delete_owned_space(uuid) to authenticated;

-- Required for Postgres Changes subscriptions used as a fallback beside Broadcast.
do $$ begin
  alter publication supabase_realtime add table public.conversation_key_requests;
exception when duplicate_object then null;
end $$;

notify pgrst, 'reload schema';
