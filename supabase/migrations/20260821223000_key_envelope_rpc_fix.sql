-- Fix key-envelope writes when PostgREST evaluates a multi-row insert/upsert
-- against the strict envelope RLS policy. The function validates every row
-- under the caller identity and writes as the table owner.
-- Run after 20260821222000_client_music_sync.sql.

create or replace function public.store_conversation_key_envelopes(p_envelopes jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  envelope record;
  inserted_count integer := 0;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if p_envelopes is null or jsonb_typeof(p_envelopes) <> 'array' then
    raise exception 'invalid_key_envelopes';
  end if;

  for envelope in
    select item.conversation_id,
           item.recipient_device_id,
           item.sender_device_id,
           item.key_epoch,
           item.ephemeral_public_key,
           item.nonce,
           item.ciphertext
    from jsonb_to_recordset(p_envelopes) as item(
      conversation_id uuid,
      recipient_device_id uuid,
      sender_device_id uuid,
      key_epoch bigint,
      ephemeral_public_key jsonb,
      nonce text,
      ciphertext text
    )
  loop
    if not public.is_conversation_member(envelope.conversation_id) then
      raise exception 'not_conversation_member';
    end if;
    if not exists (
      select 1 from public.devices sender
      where sender.id = envelope.sender_device_id
        and sender.user_id = auth.uid()
        and sender.revoked_at is null
    ) then
      raise exception 'invalid_sender_device';
    end if;
    if not exists (
      select 1
      from public.devices recipient
      join public.conversation_members member on member.user_id = recipient.user_id
      where recipient.id = envelope.recipient_device_id
        and recipient.revoked_at is null
        and member.conversation_id = envelope.conversation_id
        and member.left_at is null
    ) then
      raise exception 'invalid_recipient_device';
    end if;

    insert into public.conversation_key_envelopes (
      conversation_id,
      recipient_device_id,
      sender_device_id,
      key_epoch,
      ephemeral_public_key,
      nonce,
      ciphertext
    ) values (
      envelope.conversation_id,
      envelope.recipient_device_id,
      envelope.sender_device_id,
      envelope.key_epoch,
      envelope.ephemeral_public_key,
      envelope.nonce,
      envelope.ciphertext
    ) on conflict (conversation_id, recipient_device_id, key_epoch) do nothing;

    if found then inserted_count := inserted_count + 1; end if;
  end loop;

  return inserted_count;
end;
$$;

revoke all on function public.store_conversation_key_envelopes(jsonb) from public;
grant execute on function public.store_conversation_key_envelopes(jsonb) to authenticated;

notify pgrst, 'reload schema';
