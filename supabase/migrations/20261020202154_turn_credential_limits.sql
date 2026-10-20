create table hush_private.turn_credential_limits (
  user_id uuid primary key references auth.users(id) on delete cascade,
  window_start timestamptz not null,
  requests integer not null check (requests between 1 and 20)
);
alter table hush_private.turn_credential_limits enable row level security;
-- Intentionally no client policies: only the guarded definer function may use this table.
revoke all on hush_private.turn_credential_limits from public, anon, authenticated;

create function public.claim_turn_credentials(p_conversation_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if not public.is_conversation_member(p_conversation_id) or
    not ('connect' = any(hush_private.channel_permissions(p_conversation_id, auth.uid()))) then
    raise exception 'voice_connect_forbidden' using errcode = '42501';
  end if;
  insert into hush_private.turn_credential_limits(user_id, window_start, requests)
    values(auth.uid(), now(), 1)
  on conflict(user_id) do update set
    requests = case when turn_credential_limits.window_start <= now() - interval '10 minutes' then 1 else turn_credential_limits.requests + 1 end,
    window_start = case when turn_credential_limits.window_start <= now() - interval '10 minutes' then now() else turn_credential_limits.window_start end
  where turn_credential_limits.requests < 20 or turn_credential_limits.window_start <= now() - interval '10 minutes';
  return found;
end;
$$;
revoke all on function public.claim_turn_credentials(uuid) from public, anon;
grant execute on function public.claim_turn_credentials(uuid) to authenticated;
notify pgrst, 'reload schema';
