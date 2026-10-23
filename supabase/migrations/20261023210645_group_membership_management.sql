-- Membership changes are atomic and serialized against the conversation row.
create function public.add_group_members(p_conversation_id uuid, p_usernames text[])
returns integer language plpgsql security definer set search_path = '' as $$
declare room public.conversations%rowtype; names text[]; targets uuid[]; added integer;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  select * into room from public.conversations where id=p_conversation_id for update;
  if room.id is null or not public.is_conversation_member(p_conversation_id) then raise exception 'not_conversation_member'; end if;
  if room.kind <> 'group_dm' or room.space_id is not null or
     (not room.identity_customized and (select count(*) from public.conversation_members where conversation_id=room.id and left_at is null)<3) then
    raise exception 'not_editable_group';
  end if;
  select array_agg(distinct lower(regexp_replace(trim(value),'^@',''))) into names from unnest(p_usernames) value where trim(value)<>'';
  if coalesce(cardinality(names),0) not between 1 and 24 then raise exception 'invalid_member_count'; end if;
  select array_agg(id) into targets from public.profiles where username=any(names);
  if coalesce(cardinality(targets),0)<>cardinality(names) then raise exception 'unknown_username'; end if;
  if (select count(*) from public.conversation_members where conversation_id=room.id and left_at is null)
     + (select count(*) from unnest(targets) target where not exists(select 1 from public.conversation_members where conversation_id=room.id and user_id=target and left_at is null))>25 then
    raise exception 'group_member_limit';
  end if;
  insert into public.conversation_members(conversation_id,user_id)
    select room.id,target from unnest(targets) target
    on conflict(conversation_id,user_id) do update set left_at=null,joined_at=now() where conversation_members.left_at is not null;
  get diagnostics added = row_count;
  insert into public.conversation_key_requests(conversation_id,requester_device_id)
    select room.id,d.id from public.devices d where d.user_id=any(targets) and d.revoked_at is null on conflict do nothing;
  return added;
end; $$;
revoke all on function public.add_group_members(uuid,text[]) from public,anon;
grant execute on function public.add_group_members(uuid,text[]) to authenticated;

create function public.leave_group_dm(p_conversation_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare room public.conversations%rowtype; successor uuid;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  select * into room from public.conversations where id=p_conversation_id for update;
  if room.id is null or not public.is_conversation_member(room.id) then raise exception 'not_conversation_member'; end if;
  if room.kind<>'group_dm' or room.space_id is not null then raise exception 'not_editable_group'; end if;
  update public.conversation_members set left_at=now() where conversation_id=room.id and user_id=auth.uid();
  delete from public.conversation_key_requests where conversation_id=room.id and requester_device_id in(select id from public.devices where user_id=auth.uid());
  delete from public.conversation_key_envelopes where conversation_id=room.id and recipient_device_id in(select id from public.devices where user_id=auth.uid());
  if room.created_by=auth.uid() then
    select user_id into successor from public.conversation_members where conversation_id=room.id and left_at is null order by joined_at,user_id limit 1;
    update public.conversations set created_by=successor where id=room.id;
  end if;
end; $$;
revoke all on function public.leave_group_dm(uuid) from public,anon;
grant execute on function public.leave_group_dm(uuid) to authenticated;

-- Existing table and existing RLS membership checks govern Realtime delivery.
do $$ begin
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='conversation_members') then
    alter publication supabase_realtime add table public.conversation_members;
  end if;
end; $$;
notify pgrst,'reload schema';
