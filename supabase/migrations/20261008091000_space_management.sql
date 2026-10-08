-- Server management metadata and privileged member lifecycle operations.
create table if not exists public.space_categories (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  position integer not null default 0 check (position >= 0),
  unique (space_id, name)
);
alter table public.conversations add column if not exists category_id uuid references public.space_categories(id) on delete set null;
alter table public.conversations add column if not exists position integer not null default 0;
alter table public.conversations add column if not exists send_permission text not null default 'members' check (send_permission in ('members','admins'));
with ranked as (select id,row_number() over(partition by space_id order by created_at,id)-1 as rank from public.conversations where space_id is not null)
update public.conversations c set position=ranked.rank from ranked where c.id=ranked.id;
create index if not exists space_categories_space_idx on public.space_categories(space_id, position);
create index if not exists conversations_category_idx on public.conversations(category_id, position);

create table if not exists public.space_bans (
  space_id uuid not null references public.spaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  banned_by uuid not null references auth.users(id),
  reason text check (reason is null or char_length(reason) <= 500),
  created_at timestamptz not null default now(),
  primary key (space_id, user_id)
);
-- A pin is shared by the conversation; pinned_by records the member who set it.
alter table public.message_pins drop constraint if exists message_pins_pkey;
alter table public.message_pins add primary key (message_id);
alter table public.space_categories enable row level security;
alter table public.space_bans enable row level security;
create policy "space members read categories" on public.space_categories for select to authenticated using (public.is_space_member(space_id));
create policy "admins read bans" on public.space_bans for select to authenticated using (public.is_space_admin(space_id));
create policy "admins update invites" on public.space_invites for update to authenticated using (public.is_space_admin(space_id)) with check (public.is_space_admin(space_id));

drop policy if exists "members can insert encrypted messages" on public.encrypted_messages;
create policy "members can insert encrypted messages"
on public.encrypted_messages for insert to authenticated
with check (
  (select auth.uid()) = sender_id and public.is_conversation_member(conversation_id)
  and exists (select 1 from public.conversations c where c.id = conversation_id and (c.send_permission = 'members' or public.is_space_admin(c.space_id)))
);

create or replace function public.manage_space_member(p_space_id uuid, p_user_id uuid, p_role text)
returns void language plpgsql security definer set search_path = '' as $$
declare actor_role text; target_role text;
begin
  perform 1 from public.spaces where id=p_space_id for update;
  select role into actor_role from public.space_members where space_id = p_space_id and user_id = auth.uid();
  select role into target_role from public.space_members where space_id = p_space_id and user_id = p_user_id;
  if actor_role is null or actor_role not in ('owner','admin') then raise exception 'not_space_admin'; end if;
  if p_user_id = auth.uid() then raise exception 'cannot_manage_self'; end if;
  if target_role is null then raise exception 'member_not_found'; end if;
  if target_role = 'owner' or (actor_role = 'admin' and target_role = 'admin') then raise exception 'cannot_manage_admin'; end if;
  if p_role is null or p_role not in ('member','admin') or (p_role = 'admin' and actor_role <> 'owner') then raise exception 'invalid_member_role'; end if;
  update public.space_members set role = p_role where space_id = p_space_id and user_id = p_user_id;
end;
$$;

create or replace function public.kick_space_member(p_space_id uuid, p_user_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare actor_role text; target_role text;
begin
  perform 1 from public.spaces where id=p_space_id for update;
  select role into actor_role from public.space_members where space_id = p_space_id and user_id = auth.uid();
  select role into target_role from public.space_members where space_id = p_space_id and user_id = p_user_id;
  if actor_role is null or actor_role not in ('owner','admin') then raise exception 'not_space_admin'; end if;
  if p_user_id = auth.uid() or target_role is null then raise exception 'invalid_member_target'; end if;
  if target_role = 'owner' or (actor_role = 'admin' and target_role = 'admin') then raise exception 'cannot_manage_admin'; end if;
  update public.conversation_members cm set left_at = now() from public.conversations c where cm.conversation_id = c.id and c.space_id = p_space_id and cm.user_id = p_user_id;
  delete from public.space_members where space_id = p_space_id and user_id = p_user_id;
end;
$$;

create or replace function public.set_space_ban(p_space_id uuid, p_user_id uuid, p_banned boolean, p_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare actor_role text; target_role text;
begin
  perform 1 from public.spaces where id=p_space_id for update;
  select role into actor_role from public.space_members where space_id = p_space_id and user_id = auth.uid();
  select role into target_role from public.space_members where space_id = p_space_id and user_id = p_user_id;
  if actor_role is null or actor_role not in ('owner','admin') then raise exception 'not_space_admin'; end if;
  if p_user_id = auth.uid() or target_role = 'owner' or (actor_role = 'admin' and target_role = 'admin') then raise exception 'cannot_manage_admin'; end if;
  if p_banned then update public.conversation_members cm set left_at=now() from public.conversations c where cm.conversation_id=c.id and c.space_id=p_space_id and cm.user_id=p_user_id; delete from public.space_members where space_id=p_space_id and user_id=p_user_id; insert into public.space_bans(space_id,user_id,banned_by,reason) values (p_space_id,p_user_id,auth.uid(),left(p_reason,500)) on conflict (space_id,user_id) do update set banned_by=excluded.banned_by, reason=excluded.reason;
  else delete from public.space_bans where space_id = p_space_id and user_id = p_user_id; end if;
end;
$$;

create or replace function public.rename_space_channel(p_conversation_id uuid, p_name text)
returns void language plpgsql security definer set search_path = '' as $$
declare space uuid; clean text := lower(regexp_replace(trim(p_name), '[^a-zA-Z0-9_-]+', '-', 'g'));
begin select space_id into space from public.conversations where id=p_conversation_id and kind='channel'; if space is null or not public.is_space_admin(space) then raise exception 'not_space_admin'; end if; if char_length(clean) not between 1 and 80 then raise exception 'invalid_channel_name'; end if; update public.conversations set name=clean where id=p_conversation_id; end; $$;
create or replace function public.set_conversation_send_permission(p_conversation_id uuid, p_permission text)
returns void language plpgsql security definer set search_path = '' as $$
declare space uuid; begin select space_id into space from public.conversations where id=p_conversation_id; if space is null or not public.is_space_admin(space) then raise exception 'not_space_admin'; end if; if p_permission not in ('members','admins') then raise exception 'invalid_send_permission'; end if; update public.conversations set send_permission=p_permission where id=p_conversation_id; end; $$;
create or replace function public.reorder_space_channel(p_conversation_id uuid, p_position integer, p_category_id uuid default null)
returns void language plpgsql security definer set search_path = '' as $$
declare space uuid; begin select space_id into space from public.conversations where id=p_conversation_id; if space is null or not public.is_space_admin(space) then raise exception 'not_space_admin'; end if; if p_position is null or p_position < 0 then raise exception 'invalid_position'; end if; if p_category_id is not null and not exists(select 1 from public.space_categories where id=p_category_id and space_id=space) then raise exception 'invalid_channel_category'; end if; update public.conversations set position=(select position from public.conversations where id=p_conversation_id) where space_id=space and position=p_position and id<>p_conversation_id; update public.conversations set position=p_position, category_id=p_category_id where id=p_conversation_id; end; $$;
create or replace function public.rename_space_category(p_category_id uuid, p_name text)
returns void language plpgsql security definer set search_path = '' as $$
declare space uuid; begin select space_id into space from public.space_categories where id=p_category_id; if space is null or not public.is_space_admin(space) then raise exception 'not_space_admin'; end if; if char_length(trim(p_name)) not between 1 and 80 then raise exception 'invalid_category_name'; end if; update public.space_categories set name=trim(p_name) where id=p_category_id; end; $$;
create or replace function public.create_space_category(p_space_id uuid, p_name text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare result uuid; begin if not public.is_space_admin(p_space_id) then raise exception 'not_space_admin'; end if; if char_length(trim(p_name)) not between 1 and 80 then raise exception 'invalid_category_name'; end if; insert into public.space_categories(space_id,name,position) values(p_space_id,trim(p_name),(select coalesce(max(position)+1,0) from public.space_categories where space_id=p_space_id)) returning id into result; return result; end; $$;
create or replace function public.delete_space_category(p_category_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare space uuid; begin select space_id into space from public.space_categories where id=p_category_id; if space is null or not public.is_space_admin(space) then raise exception 'not_space_admin'; end if; update public.conversations set category_id=null where category_id=p_category_id; delete from public.space_categories where id=p_category_id; end; $$;
create or replace function public.reorder_space_category(p_category_id uuid, p_position integer)
returns void language plpgsql security definer set search_path = '' as $$
declare space uuid; begin select space_id into space from public.space_categories where id=p_category_id; if space is null or not public.is_space_admin(space) or p_position < 0 then raise exception 'invalid_category_position'; end if; update public.space_categories set position=(select position from public.space_categories where id=p_category_id) where space_id=space and position=p_position and id<>p_category_id; update public.space_categories set position=p_position where id=p_category_id; end; $$;
create or replace function public.revoke_space_invite(p_invite_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare space uuid; begin select space_id into space from public.space_invites where id=p_invite_id; if space is null or not public.is_space_admin(space) then raise exception 'not_space_admin'; end if; update public.space_invites set revoked_at=now() where id=p_invite_id; end; $$;

-- Invitations never add a banned user back to a space.
create or replace function public.join_space_with_invite(p_token text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare current_user_id uuid := auth.uid(); selected_invite public.space_invites%rowtype; result uuid;
begin
  select * into selected_invite from public.space_invites where token_hash=encode(extensions.digest(trim(p_token),'sha256'),'hex') and revoked_at is null and expires_at>now() and use_count<max_uses for update;
  if selected_invite.id is null then raise exception 'invalid_or_expired_invite'; end if;
  if exists(select 1 from public.space_bans where space_id=selected_invite.space_id and user_id=current_user_id) then raise exception 'space_banned'; end if;
  insert into public.space_members(space_id,user_id,role) values(selected_invite.space_id,current_user_id,'member') on conflict (space_id,user_id) do nothing;
  insert into public.conversation_members(conversation_id,user_id) select id,current_user_id from public.conversations where space_id=selected_invite.space_id on conflict (conversation_id,user_id) do update set left_at=null;
  insert into public.conversation_key_requests(conversation_id, requester_device_id)
  select c.id, d.id from public.conversations c cross join public.devices d
  where c.space_id = selected_invite.space_id and d.user_id = current_user_id and d.revoked_at is null on conflict do nothing;
  update public.space_invites set use_count=use_count+1 where id=selected_invite.id;
  result := selected_invite.space_id; return result;
end; $$;

grant execute on function public.manage_space_member(uuid,uuid,text) to authenticated;
grant execute on function public.kick_space_member(uuid,uuid) to authenticated;
grant execute on function public.set_space_ban(uuid,uuid,boolean,text) to authenticated;
grant execute on function public.rename_space_channel(uuid,text) to authenticated;
grant execute on function public.set_conversation_send_permission(uuid,text) to authenticated;
grant execute on function public.reorder_space_channel(uuid,integer,uuid) to authenticated;
grant execute on function public.rename_space_category(uuid,text) to authenticated;
grant execute on function public.create_space_category(uuid,text) to authenticated;
grant execute on function public.delete_space_category(uuid) to authenticated;
grant execute on function public.reorder_space_category(uuid,integer) to authenticated;
grant execute on function public.revoke_space_invite(uuid) to authenticated;
grant execute on function public.join_space_with_invite(text) to authenticated;
grant select on public.space_categories, public.space_bans to authenticated;
revoke execute on function public.manage_space_member(uuid,uuid,text) from public, anon;
revoke execute on function public.kick_space_member(uuid,uuid) from public, anon;
revoke execute on function public.set_space_ban(uuid,uuid,boolean,text) from public, anon;
revoke execute on function public.rename_space_channel(uuid,text) from public, anon;
revoke execute on function public.set_conversation_send_permission(uuid,text) from public, anon;
revoke execute on function public.reorder_space_channel(uuid,integer,uuid) from public, anon;
revoke execute on function public.rename_space_category(uuid,text) from public, anon;
revoke execute on function public.create_space_category(uuid,text) from public, anon;
revoke execute on function public.delete_space_category(uuid) from public, anon;
revoke execute on function public.reorder_space_category(uuid,integer) from public, anon;
revoke execute on function public.revoke_space_invite(uuid) from public, anon;
revoke execute on function public.join_space_with_invite(text) from public, anon;

grant select on public.conversations, public.space_members, public.space_invites, public.profiles to authenticated;
