create table public.friendships (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.profiles(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (requester_id <> recipient_id)
);
create unique index friendships_pair_idx on public.friendships
  (least(requester_id, recipient_id), greatest(requester_id, recipient_id));
create index friendships_requester_idx on public.friendships(requester_id);
create index friendships_recipient_idx on public.friendships(recipient_id);
alter table public.friendships enable row level security;
revoke all on public.friendships from public, anon, authenticated;
grant select, insert, update, delete on public.friendships to authenticated;
grant all on public.friendships to service_role;

create policy "participants read friendships" on public.friendships for select to authenticated
  using ((select auth.uid()) in (requester_id, recipient_id));
create policy "users send pending requests" on public.friendships for insert to authenticated
  with check (requester_id = (select auth.uid()) and status = 'pending');
create policy "recipients accept pending requests" on public.friendships for update to authenticated
  using (recipient_id = (select auth.uid()) and status = 'pending')
  with check (recipient_id = (select auth.uid()) and status = 'accepted');
create policy "participants remove relationships" on public.friendships for delete to authenticated
  using ((select auth.uid()) in (requester_id, recipient_id));

-- Policies restrict the actor; this trigger also makes the participants and
-- creation time immutable, so accepting cannot redirect a request to somebody else.
create function public.guard_friendship() returns trigger language plpgsql
security invoker set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    if (new.id, new.requester_id, new.recipient_id, new.created_at)
       is distinct from (old.id, old.requester_id, old.recipient_id, old.created_at)
       or old.status <> 'pending' or new.status <> 'accepted' then
      raise exception 'invalid_friendship_transition' using errcode = '23514';
    end if;
  else
    if new.requester_id <> auth.uid() or new.status <> 'pending' then
      raise exception 'invalid_friend_request' using errcode = '42501';
    end if;
    -- Serialize sends by the same user, including sends to different recipients.
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.requester_id::text, 0));
    if (select count(*) from public.friendships where requester_id = new.requester_id and status = 'pending') >= 100 then
      raise exception 'too_many_friend_requests' using errcode = '23514';
    end if;
    new.created_at := now();
  end if;
  new.updated_at := now();
  return new;
end $$;
revoke all on function public.guard_friendship() from public, anon, authenticated;
create trigger guard_friendship before insert or update on public.friendships
  for each row execute function public.guard_friendship();

-- Exact usernames only: there is no public directory or prefix search.
create function public.send_friend_request(p_username text) returns uuid language plpgsql
security invoker set search_path = '' as $$
declare target_id uuid; result_id uuid;
begin
  if auth.uid() is null then raise exception 'authentication_required' using errcode = '42501'; end if;
  select id into target_id from public.profiles
    where username = lower(ltrim(trim(p_username), '@'));
  if target_id is null then raise exception 'unknown_username' using errcode = '22023'; end if;
  if target_id = auth.uid() then raise exception 'cannot_friend_yourself' using errcode = '22023'; end if;
  insert into public.friendships(requester_id, recipient_id)
    values(auth.uid(), target_id) returning id into result_id;
  return result_id;
end $$;
revoke all on function public.send_friend_request(text) from public, anon;
grant execute on function public.send_friend_request(text) to authenticated;

do $$ begin
  alter publication supabase_realtime add table public.friendships;
exception when duplicate_object then null;
end $$;
notify pgrst, 'reload schema';
