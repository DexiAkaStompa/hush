-- Supabase installs pgcrypto in the extensions schema. Security-definer
-- functions with an empty search_path must reference those functions explicitly.

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
  values (
    p_space_id,
    encode(extensions.digest(raw_token, 'sha256'), 'hex'),
    auth.uid()
  );
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

grant execute on function public.create_space_invite(uuid) to authenticated;
grant execute on function public.join_space_with_invite(text) to authenticated;

notify pgrst, 'reload schema';
