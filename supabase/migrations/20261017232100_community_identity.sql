alter table public.spaces
  add column identity_customized boolean not null default false,
  add column description text not null default '' check (char_length(description) <= 500),
  add column accent_color text not null default '#73b7ff' check (accent_color ~ '^#[0-9a-fA-F]{6}$'),
  add column icon_data text check (icon_data is null or (length(icon_data) <= 32768 and icon_data ~ '^data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$')),
  add column banner_data text check (banner_data is null or (length(banner_data) <= 131072 and banner_data ~ '^data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$'));

alter table public.conversations
  add column identity_customized boolean not null default false,
  add column description text not null default '' check (char_length(description) <= 500),
  add column accent_color text not null default '#73b7ff' check (accent_color ~ '^#[0-9a-fA-F]{6}$'),
  add column icon_data text check (icon_data is null or (length(icon_data) <= 32768 and icon_data ~ '^data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$')),
  add column banner_data text check (banner_data is null or (length(banner_data) <= 131072 and banner_data ~ '^data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$'));

create function public.update_community_identity(p_kind text, p_id uuid, p_name text, p_description text, p_accent text, p_icon text, p_banner text)
returns void language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid(); target_space uuid; target_kind text;
begin
  if actor is null then raise exception 'not_authenticated'; end if;
  if char_length(trim(p_name)) not between 1 and 80 or p_name is null or p_description is null or char_length(p_description)>500 or p_accent is null or p_accent !~ '^#[0-9a-fA-F]{6}$' then raise exception 'invalid_identity'; end if;
  if p_kind='space' then
    perform 1 from public.spaces where id=p_id for update;
    if not exists(select 1 from public.space_members where space_id=p_id and user_id=actor and role in ('owner','admin')) then raise exception 'forbidden'; end if;
    update public.spaces set name=trim(p_name), description=trim(p_description),accent_color=p_accent,icon_data=p_icon,banner_data=p_banner,identity_customized=true where id=p_id;
  elsif p_kind='conversation' then
    select space_id,kind into target_space,target_kind from public.conversations where id=p_id for update;
    if not found then raise exception 'forbidden'; end if;
    if target_kind='group_dm' then
      if not exists(select 1 from public.conversation_members where conversation_id=p_id and user_id=actor and left_at is null) then raise exception 'forbidden'; end if;
    elsif not exists(select 1 from public.space_members where space_id=target_space and user_id=actor and role in ('owner','admin')) then raise exception 'forbidden';
    end if;
    update public.conversations set name=trim(p_name),description=trim(p_description),accent_color=p_accent,icon_data=p_icon,banner_data=p_banner,identity_customized=true where id=p_id;
  else raise exception 'invalid_identity'; end if;
end;
$$;
revoke all on function public.update_community_identity(text,uuid,text,text,text,text,text) from public,anon;
grant execute on function public.update_community_identity(text,uuid,text,text,text,text,text) to authenticated;
do $$ begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime') then
    if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='spaces') then alter publication supabase_realtime add table public.spaces; end if;
    if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='conversations') then alter publication supabase_realtime add table public.conversations; end if;
  end if;
end $$;
notify pgrst, 'reload schema';
