-- Allow Auth to delete an account without leaving broken foreign keys.
-- Owned spaces are removed with their owner; shared content is retained but anonymised.

alter table public.spaces
  drop constraint if exists spaces_owner_id_fkey;
alter table public.spaces
  add constraint spaces_owner_id_fkey
  foreign key (owner_id) references auth.users(id) on delete cascade;

alter table public.conversations
  alter column created_by drop not null;
alter table public.conversations
  drop constraint if exists conversations_created_by_fkey;
alter table public.conversations
  add constraint conversations_created_by_fkey
  foreign key (created_by) references auth.users(id) on delete set null;

alter table public.encrypted_messages
  alter column sender_id drop not null;
alter table public.encrypted_messages
  drop constraint if exists encrypted_messages_sender_id_fkey;
alter table public.encrypted_messages
  add constraint encrypted_messages_sender_id_fkey
  foreign key (sender_id) references auth.users(id) on delete set null;

alter table public.conversation_music_state
  alter column updated_by drop not null;
alter table public.conversation_music_state
  drop constraint if exists conversation_music_state_updated_by_fkey;
alter table public.conversation_music_state
  add constraint conversation_music_state_updated_by_fkey
  foreign key (updated_by) references auth.users(id) on delete set null;

notify pgrst, 'reload schema';
