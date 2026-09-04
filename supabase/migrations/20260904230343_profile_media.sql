-- Profile media is private to authenticated Hush members, like profiles.
begin;
alter table public.profiles
  add column if not exists avatar_path text,
  add column if not exists banner_path text,
  add column if not exists bio text not null default '';

alter table public.profiles drop constraint if exists profile_avatar_owned;
alter table public.profiles add constraint profile_avatar_owned check (avatar_path is null or
  (split_part(avatar_path, '/', 1) = id::text and avatar_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(png|jpg|gif|webp)$'));

alter table public.profiles drop constraint if exists profile_banner_owned;
alter table public.profiles add constraint profile_banner_owned check (banner_path is null or
  (split_part(banner_path, '/', 1) = id::text and banner_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(png|jpg|gif|webp)$'));

alter table public.profiles drop constraint if exists profile_bio_length;
alter table public.profiles add constraint profile_bio_length check (char_length(bio) <= 190);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('profile-media', 'profile-media', false, 8388608,
  array['image/png', 'image/jpeg', 'image/gif', 'image/webp'])
on conflict (id) do nothing;

drop policy if exists "Members can read profile media" on storage.objects;
create policy "Members can read profile media" on storage.objects
  for select to authenticated using (bucket_id = 'profile-media');

drop policy if exists "Members can upload their profile media" on storage.objects;
create policy "Members can upload their profile media" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'profile-media' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "Members can delete their profile media" on storage.objects;
create policy "Members can delete their profile media" on storage.objects
  for delete to authenticated using (
    bucket_id = 'profile-media' and (storage.foldername(name))[1] = (select auth.uid())::text);

notify pgrst, 'reload schema';
commit;
