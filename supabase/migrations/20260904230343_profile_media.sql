-- Profile media is private to authenticated Hush members, like profiles.
begin;
alter table public.profiles
  add column avatar_path text,
  add column banner_path text,
  add column bio text not null default '' check (char_length(bio) <= 190),
  add constraint profile_avatar_owned check (avatar_path is null or
    (split_part(avatar_path, '/', 1) = id::text and avatar_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(png|jpg|gif|webp)$')),
  add constraint profile_banner_owned check (banner_path is null or
    (split_part(banner_path, '/', 1) = id::text and banner_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(png|jpg|gif|webp)$'));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('profile-media', 'profile-media', false, 8388608,
  array['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

create policy "Members can read profile media" on storage.objects
  for select to authenticated using (bucket_id = 'profile-media');
create policy "Members can upload their profile media" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'profile-media' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "Members can delete their profile media" on storage.objects
  for delete to authenticated using (
    bucket_id = 'profile-media' and (storage.foldername(name))[1] = (select auth.uid())::text);

notify pgrst, 'reload schema';
commit;
