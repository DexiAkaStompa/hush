-- Encrypted chat media bucket for Hush channels and DMs.
-- All files in this bucket are AES-256-GCM encrypted client-side before upload.
begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('chat-media', 'chat-media', false, 16777216,
  array['application/octet-stream', 'image/png', 'image/jpeg', 'image/gif', 'image/webp'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Members can read chat media" on storage.objects;
create policy "Members can read chat media" on storage.objects
  for select to authenticated using (bucket_id = 'chat-media');

drop policy if exists "Members can upload chat media" on storage.objects;
create policy "Members can upload chat media" on storage.objects
  for insert to authenticated with check (bucket_id = 'chat-media');

drop policy if exists "Members can delete their chat media" on storage.objects;
create policy "Members can delete their chat media" on storage.objects
  for delete to authenticated using (
    bucket_id = 'chat-media' and (storage.foldername(name))[2] = (select auth.uid())::text);

notify pgrst, 'reload schema';
commit;
