-- Child rows retain the room id after a message has been deleted.
create or replace function public.broadcast_message_extras() returns trigger security definer set search_path = '' language plpgsql as $$
declare message_row public.encrypted_messages;
begin
 select * into message_row from public.encrypted_messages where id=coalesce(new.message_id,old.message_id);
 perform realtime.broadcast_changes('conversation:' || coalesce(new.conversation_id,old.conversation_id)::text,'EXTRAS','EXTRAS','encrypted_messages','public',message_row,message_row);
 return coalesce(new,old);
end; $$;
