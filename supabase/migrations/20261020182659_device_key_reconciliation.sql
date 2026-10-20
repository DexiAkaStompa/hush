-- Initialization is a conversation-wide operation, never a per-device key reset.
create or replace function public.initialize_conversation_key_envelopes(p_conversation_id uuid, p_envelopes jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if not public.is_conversation_member(p_conversation_id) or not exists (
    select 1 from public.conversations c where c.id = p_conversation_id and c.created_by = auth.uid()
  ) then raise exception 'not_conversation_creator'; end if;
  if p_envelopes is null or jsonb_typeof(p_envelopes) <> 'array' or jsonb_array_length(p_envelopes) = 0 then
    raise exception 'invalid_key_envelopes';
  end if;
  if exists (select 1 from jsonb_array_elements(p_envelopes) e
    where (e->>'conversation_id')::uuid is distinct from p_conversation_id
       or (e->>'key_epoch')::bigint is distinct from 0) then raise exception 'invalid_key_envelopes'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_conversation_id::text, 80117));
  if exists (select 1 from public.conversation_key_envelopes where conversation_id = p_conversation_id) then
    return 0;
  end if;
  return public.store_conversation_key_envelopes(p_envelopes);
end;
$$;
revoke all on function public.initialize_conversation_key_envelopes(uuid,jsonb) from public, anon;
grant execute on function public.initialize_conversation_key_envelopes(uuid,jsonb) to authenticated;

-- Exposes only missing slot metadata to current members, never other devices' ciphertext.
create or replace function public.missing_conversation_key_envelopes(p_conversation_id uuid, p_key_ids bigint[])
returns table(recipient_device_id uuid, key_epoch bigint)
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if not public.is_conversation_member(p_conversation_id) then raise exception 'not_conversation_member'; end if;
  if coalesce(cardinality(p_key_ids),0) > 128 or exists(select 1 from unnest(p_key_ids) k where k < 0 or k is null) then
    raise exception 'invalid_key_ids';
  end if;
  return query select d.id, k.id
    from public.devices d
    join public.conversation_members m on m.user_id = d.user_id
    cross join (select distinct unnest(p_key_ids) as id) k
    where m.conversation_id = p_conversation_id and m.left_at is null and d.revoked_at is null
      and not exists (select 1 from public.conversation_key_envelopes e
        where e.conversation_id = p_conversation_id and e.recipient_device_id = d.id and e.key_epoch = k.id);
end;
$$;
revoke all on function public.missing_conversation_key_envelopes(uuid,bigint[]) from public, anon;
grant execute on function public.missing_conversation_key_envelopes(uuid,bigint[]) to authenticated;
notify pgrst, 'reload schema';
