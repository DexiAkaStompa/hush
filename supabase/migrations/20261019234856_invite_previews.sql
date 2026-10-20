-- An invite holder may see the server identity, not its private channels or members.
create function public.get_space_invite_preview(p_token text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare target uuid; result jsonb;
begin
  if auth.uid() is null or p_token !~ '^[a-f0-9]{48}$' then return null; end if;
  select space_id into target from public.space_invites
    where token_hash=encode(extensions.digest(p_token,'sha256'),'hex')
    and revoked_at is null and expires_at>now() and use_count<max_uses;
  if target is null or exists(select 1 from public.space_bans where space_id=target and user_id=auth.uid()) then return null; end if;
  select jsonb_build_object('id',s.id,'name',s.name,'icon_data',s.icon_data,
    'member_count',(select count(*) from public.space_members where space_id=target),
    'is_member',exists(select 1 from public.space_members where space_id=target and user_id=auth.uid()))
    into result from public.spaces s where s.id=target;
  return result;
end $$;
revoke all on function public.get_space_invite_preview(text) from public, anon;
grant execute on function public.get_space_invite_preview(text) to authenticated;
notify pgrst,'reload schema';
