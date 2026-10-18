-- Custom server roles, channel overrides and deterministic ordering.
create schema if not exists hush_private;
revoke all on schema hush_private from public;

create table public.space_roles (
 id uuid primary key default gen_random_uuid(), space_id uuid not null references public.spaces(id) on delete cascade,
 name text not null check(char_length(trim(name)) between 1 and 48), color text not null default '#b8bbc2' check(color ~ '^#[0-9a-fA-F]{6}$'),
 position integer not null default 0 check(position>=0), is_default boolean not null default false, mentionable boolean not null default true,
 permissions text[] not null default '{}' check(permissions <@ array['send_messages','add_reactions','connect','mention_everyone','pin_messages','manage_messages']::text[] and array_position(permissions,null) is null),
 unique(space_id,name), unique(space_id,id), check(not is_default or name='everyone')
);
create unique index space_roles_default_idx on public.space_roles(space_id) where is_default;
create index space_roles_order_idx on public.space_roles(space_id,position);
create table public.space_member_roles (
 space_id uuid not null, user_id uuid not null, role_id uuid not null,
 primary key(space_id,user_id,role_id), foreign key(space_id,user_id) references public.space_members(space_id,user_id) on delete cascade,
 foreign key(space_id,role_id) references public.space_roles(space_id,id) on delete cascade
);
create index space_member_roles_role_idx on public.space_member_roles(role_id,user_id);
create table public.channel_role_overrides (
 conversation_id uuid not null references public.conversations(id) on delete cascade, role_id uuid not null references public.space_roles(id) on delete cascade,
 allow_permissions text[] not null default '{}' check(allow_permissions <@ array['send_messages','add_reactions','connect','mention_everyone','pin_messages','manage_messages']::text[] and array_position(allow_permissions,null) is null),
 deny_permissions text[] not null default '{}' check(deny_permissions <@ array['send_messages','add_reactions','connect','mention_everyone','pin_messages','manage_messages']::text[] and array_position(deny_permissions,null) is null),
 primary key(conversation_id,role_id), check(not(allow_permissions && deny_permissions))
);
create index channel_role_overrides_role_idx on public.channel_role_overrides(role_id);

create function hush_private.seed_space_role() returns trigger language plpgsql security definer set search_path='' as $$
begin insert into public.space_roles(space_id,name,is_default,permissions) values(new.id,'everyone',true,array['send_messages','add_reactions','connect','pin_messages']); return new; end; $$;
create trigger seed_space_role after insert on public.spaces for each row execute function hush_private.seed_space_role();
insert into public.space_roles(space_id,name,is_default,permissions) select id,'everyone',true,array['send_messages','add_reactions','connect','pin_messages'] from public.spaces;

alter table public.space_roles enable row level security;
alter table public.space_member_roles enable row level security;
alter table public.channel_role_overrides enable row level security;
create policy "members read server roles" on public.space_roles for select to authenticated using(public.is_space_member(space_id));
create policy "members read role assignments" on public.space_member_roles for select to authenticated using(public.is_space_member(space_id));
create policy "members read channel overrides" on public.channel_role_overrides for select to authenticated using(public.is_conversation_member(conversation_id));
grant select on public.space_roles,public.space_member_roles,public.channel_role_overrides to authenticated;

create function hush_private.channel_permissions(p_conversation uuid,p_user uuid) returns text[] language plpgsql stable security definer set search_path='' as $$
declare sid uuid; legacy text; result text[]; denied text[]; allowed text[];
begin
 if p_user is null or not exists(select 1 from public.conversation_members where conversation_id=p_conversation and user_id=p_user and left_at is null) then return '{}'; end if;
 select space_id,send_permission into sid,legacy from public.conversations where id=p_conversation;
 if sid is null then return array['send_messages','add_reactions','connect','mention_everyone','pin_messages']; end if;
 if not exists(select 1 from public.space_members where space_id=sid and user_id=p_user) then return '{}'; end if;
 if exists(select 1 from public.space_members where space_id=sid and user_id=p_user and role in('owner','admin')) then return array['send_messages','add_reactions','connect','mention_everyone','pin_messages','manage_messages']; end if;
 select coalesce(array_agg(distinct permission),'{}') into result from public.space_roles r cross join lateral unnest(r.permissions) permission where r.space_id=sid and (r.is_default or exists(select 1 from public.space_member_roles m where m.space_id=sid and m.user_id=p_user and m.role_id=r.id));
 select o.deny_permissions,o.allow_permissions into denied,allowed from public.channel_role_overrides o join public.space_roles r on r.id=o.role_id where o.conversation_id=p_conversation and r.is_default;
 result:=array(select distinct x from unnest(result||coalesce(allowed,'{}')) x where not(x=any(coalesce(denied,'{}'))));
 select coalesce(array_agg(distinct d),'{}') into denied from public.channel_role_overrides o join public.space_member_roles m on m.role_id=o.role_id and m.user_id=p_user and m.space_id=sid cross join lateral unnest(o.deny_permissions) d where o.conversation_id=p_conversation;
 select coalesce(array_agg(distinct a),'{}') into allowed from public.channel_role_overrides o join public.space_member_roles m on m.role_id=o.role_id and m.user_id=p_user and m.space_id=sid cross join lateral unnest(o.allow_permissions) a where o.conversation_id=p_conversation;
 result:=array(select distinct x from unnest(result) x where not(x=any(denied)));
 result:=array(select distinct x from unnest(result||allowed) x);
 if legacy='admins' then result:=array_remove(result,'send_messages'); end if;
 return result;
end; $$;

create function public.get_conversation_permissions(p_conversation_ids uuid[]) returns table(conversation_id uuid,permissions text[]) language sql stable security definer set search_path='' as $$
 select c.id,hush_private.channel_permissions(c.id,auth.uid()) from public.conversations c where c.id=any(p_conversation_ids[1:500]) and public.is_conversation_member(c.id);
$$;
create function public.save_space_role(p_space_id uuid,p_role_id uuid,p_name text,p_color text,p_permissions text[],p_mentionable boolean) returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid; def boolean;
begin
 if auth.uid() is null or not public.is_space_admin(p_space_id) then raise exception 'not_space_admin'; end if;
 perform 1 from public.spaces where id=p_space_id for update;
 if p_role_id is null then
  if (select count(*) from public.space_roles where space_id=p_space_id)>=100 then raise exception 'role_limit'; end if;
  insert into public.space_roles(space_id,name,color,permissions,mentionable,position) values(p_space_id,trim(p_name),p_color,p_permissions,p_mentionable,(select coalesce(max(position),0)+1 from public.space_roles where space_id=p_space_id)) returning id into result;
 else
  select is_default into def from public.space_roles where id=p_role_id and space_id=p_space_id;
  if def is null then raise exception 'role_not_found'; end if;
  update public.space_roles set name=case when def then 'everyone' else trim(p_name) end,color=p_color,permissions=p_permissions,mentionable=p_mentionable where id=p_role_id and space_id=p_space_id returning id into result;
 end if;
 return result;
end; $$;
create function public.delete_space_role(p_role_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare sid uuid; def boolean;
begin select space_id,is_default into sid,def from public.space_roles where id=p_role_id; if sid is null or not public.is_space_admin(sid) then raise exception 'not_space_admin'; end if; if def then raise exception 'default_role_required'; end if; delete from public.space_roles where id=p_role_id; end; $$;
create function public.set_member_space_roles(p_space_id uuid,p_user_id uuid,p_role_ids uuid[]) returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.is_space_admin(p_space_id) then raise exception 'not_space_admin'; end if;
 perform 1 from public.spaces where id=p_space_id for update;
 if not exists(select 1 from public.space_members where space_id=p_space_id and user_id=p_user_id) then raise exception 'member_not_found'; end if;
 if exists(select 1 from public.space_members where space_id=p_space_id and user_id=p_user_id and role='owner') and not exists(select 1 from public.space_members where space_id=p_space_id and user_id=auth.uid() and role='owner') then raise exception 'cannot_manage_admin'; end if;
 if p_role_ids is null or cardinality(p_role_ids)>100 or exists(select 1 from unnest(p_role_ids) x where not exists(select 1 from public.space_roles where id=x and space_id=p_space_id and not is_default)) then raise exception 'invalid_role_assignment'; end if;
 delete from public.space_member_roles where space_id=p_space_id and user_id=p_user_id;
 insert into public.space_member_roles(space_id,user_id,role_id) select p_space_id,p_user_id,x from (select distinct unnest(p_role_ids) x) roles;
end; $$;
create function public.save_channel_role_override(p_conversation_id uuid,p_role_id uuid,p_allow text[],p_deny text[]) returns void language plpgsql security definer set search_path='' as $$
declare sid uuid;
begin
 select space_id into sid from public.conversations where id=p_conversation_id;
 if sid is null or not public.is_space_admin(sid) then raise exception 'not_space_admin'; end if;
 if not exists(select 1 from public.space_roles where id=p_role_id and space_id=sid) then raise exception 'invalid_role_assignment'; end if;
 insert into public.channel_role_overrides(conversation_id,role_id,allow_permissions,deny_permissions) values(p_conversation_id,p_role_id,p_allow,p_deny) on conflict(conversation_id,role_id) do update set allow_permissions=excluded.allow_permissions,deny_permissions=excluded.deny_permissions;
end; $$;
create function public.reorder_space_channels(p_space_id uuid,p_order uuid[]) returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.is_space_admin(p_space_id) then raise exception 'not_space_admin'; end if;
 perform 1 from public.spaces where id=p_space_id for update;
 if p_order is null or cardinality(p_order)<>(select count(*) from public.conversations where space_id=p_space_id) or cardinality(p_order)<>(select count(distinct x) from unnest(p_order) x) or exists(select 1 from unnest(p_order) x where not exists(select 1 from public.conversations where id=x and space_id=p_space_id)) then raise exception 'invalid_channel_order'; end if;
 update public.conversations c set position=ordered.n-1 from unnest(p_order) with ordinality ordered(id,n) where c.id=ordered.id and c.space_id=p_space_id;
end; $$;
-- Voice channels use the same rename operation as text channels.
create or replace function public.rename_space_channel(p_conversation_id uuid,p_name text) returns void language plpgsql security definer set search_path='' as $$
declare sid uuid; kind text; clean text;
begin
 select space_id,c.kind into sid,kind from public.conversations c where id=p_conversation_id and c.kind in('channel','voice_channel');
 if sid is null or not public.is_space_admin(sid) then raise exception 'not_space_admin'; end if;
 clean:=case when kind='voice_channel' then trim(p_name) else lower(regexp_replace(trim(p_name),'[^a-zA-Z0-9_-]+','-','g')) end;
 if clean is null or char_length(clean) not between 1 and 80 then raise exception 'invalid_channel_name'; end if;
 update public.conversations set name=clean where id=p_conversation_id;
end; $$;

drop policy "members can insert encrypted messages" on public.encrypted_messages;
-- RLS calls this narrowly-scoped wrapper as the querying user.
create function public.can_send_to_conversation(p_conversation_id uuid) returns boolean language sql stable security definer set search_path='' as $$ select auth.uid() is not null and 'send_messages'=any(hush_private.channel_permissions(p_conversation_id,auth.uid())); $$;
create policy "members can insert encrypted messages" on public.encrypted_messages for insert to authenticated with check(sender_id=auth.uid() and public.can_send_to_conversation(conversation_id));

create or replace function public.toggle_message_reaction(p_message_id uuid,p_emoji text) returns boolean language plpgsql security definer set search_path='' as $$
declare cid uuid; removed integer;
begin
 if auth.uid() is null or p_emoji is null or char_length(p_emoji) not between 1 and 32 then raise exception 'invalid_reaction'; end if;
 select conversation_id into cid from public.encrypted_messages where id=p_message_id for update;
 if cid is null or not public.is_conversation_member(cid) then raise exception 'reaction_forbidden' using errcode='42501'; end if;
 delete from public.message_reactions where message_id=p_message_id and user_id=auth.uid() and emoji=p_emoji;
 get diagnostics removed=row_count;
 if removed>0 then return false; end if;
 if not('add_reactions'=any(hush_private.channel_permissions(cid,auth.uid()))) then raise exception 'reaction_forbidden' using errcode='42501'; end if;
 insert into public.message_reactions(conversation_id,message_id,user_id,emoji) values(cid,p_message_id,auth.uid(),p_emoji);
 return true;
end; $$;
-- Realtime's event name may be EXTRAS, but its operation must be TG_OP.
create or replace function public.broadcast_message_extras() returns trigger language plpgsql security definer set search_path='' as $$
declare message_row public.encrypted_messages;
begin
 select * into message_row from public.encrypted_messages where id=coalesce(new.message_id,old.message_id);
 perform realtime.broadcast_changes('conversation:'||coalesce(new.conversation_id,old.conversation_id)::text,'EXTRAS',TG_OP,'encrypted_messages','public',message_row,message_row);
 return coalesce(new,old);
end; $$;
create or replace function public.toggle_message_pin(p_message_id uuid) returns boolean language plpgsql security definer set search_path='' as $$
declare cid uuid; removed integer;
begin
 select conversation_id into cid from public.encrypted_messages where id=p_message_id for update;
 if auth.uid() is null or cid is null or not('pin_messages'=any(hush_private.channel_permissions(cid,auth.uid()))) then raise exception 'pin_forbidden' using errcode='42501'; end if;
 delete from public.message_pins where message_id=p_message_id;
 get diagnostics removed=row_count;
 if removed>0 then return false; end if;
 insert into public.message_pins(conversation_id,message_id,pinned_by) values(cid,p_message_id,auth.uid()); return true;
end; $$;
create or replace function public.delete_encrypted_message(p_message_id uuid) returns boolean language plpgsql security definer set search_path='' as $$
declare removed integer;
begin
 delete from public.encrypted_messages m where m.id=p_message_id and public.is_conversation_member(m.conversation_id) and (m.sender_id=auth.uid() or 'manage_messages'=any(hush_private.channel_permissions(m.conversation_id,auth.uid())));
 get diagnostics removed=row_count;
 if removed=0 then raise exception 'message_delete_forbidden' using errcode='42501'; end if; return true;
end; $$;
create or replace function public.can_access_realtime_topic(requested_topic text) returns boolean language plpgsql stable security definer set search_path='' as $$
declare cid uuid;
begin
 if requested_topic !~ '^(conversation|call|music):[0-9a-fA-F-]{36}$' then return false; end if;
 cid:=split_part(requested_topic,':',2)::uuid;
 if not public.is_conversation_member(cid) then return false; end if;
 return split_part(requested_topic,':',1)<>'call' or 'connect'=any(hush_private.channel_permissions(cid,auth.uid()));
exception when invalid_text_representation then return false;
end; $$;


-- Appending channels preserves the order chosen by administrators.
create function hush_private.append_channel_position() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.space_id is not null then
  perform 1 from public.spaces where id=new.space_id for update;
  select coalesce(max(position),-1)+1 into new.position from public.conversations where space_id=new.space_id;
 end if;
 return new;
end; $$;
create trigger append_channel_position before insert on public.conversations for each row execute function hush_private.append_channel_position();

create or replace function public.update_encrypted_message(p_message_id uuid,p_nonce text,p_ciphertext text,p_aad_json jsonb) returns public.encrypted_messages language plpgsql security definer set search_path='' as $$
declare result public.encrypted_messages;
begin
 update public.encrypted_messages m set nonce=p_nonce,ciphertext=p_ciphertext,aad_json=coalesce(p_aad_json,'{}'::jsonb)
 where m.id=p_message_id and m.sender_id=auth.uid() and public.can_send_to_conversation(m.conversation_id) returning m.* into result;
 if result.id is null then raise exception 'message_edit_forbidden' using errcode='42501'; end if;
 return result;
end; $$;

revoke all on all functions in schema hush_private from public,anon,authenticated;
revoke all on function public.get_conversation_permissions(uuid[]),public.save_space_role(uuid,uuid,text,text,text[],boolean),public.delete_space_role(uuid),public.set_member_space_roles(uuid,uuid,uuid[]),public.save_channel_role_override(uuid,uuid,text[],text[]),public.reorder_space_channels(uuid,uuid[]),public.can_send_to_conversation(uuid) from public,anon;
grant execute on function public.get_conversation_permissions(uuid[]),public.save_space_role(uuid,uuid,text,text,text[],boolean),public.delete_space_role(uuid),public.set_member_space_roles(uuid,uuid,uuid[]),public.save_channel_role_override(uuid,uuid,text[],text[]),public.reorder_space_channels(uuid,uuid[]),public.can_send_to_conversation(uuid) to authenticated;
notify pgrst,'reload schema';
