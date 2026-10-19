import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import migration from "../../supabase/migrations/20261019222510_friendships.sql?raw";
const db = new PGlite();
const a = "00000000-0000-0000-0000-000000000001",
  b = "00000000-0000-0000-0000-000000000002",
  c = "00000000-0000-0000-0000-000000000003";
beforeAll(async () => {
  await db.exec(`create role authenticated;create role anon;create role service_role;
    create schema auth;create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth,public to authenticated,anon;
    create table public.profiles(id uuid primary key, username text unique);
    grant select on public.profiles to authenticated;`);
  await db.exec(
    migration
      .replace(/do \$\$ begin[\s\S]*?end \$\$;/i, "")
      .replace(/notify pgrst, 'reload schema';/i, ""),
  );
});
beforeEach(async () => {
  await db.exec(
    `truncate public.friendships,public.profiles cascade;insert into public.profiles values('${a}','alice'),('${b}','bob'),('${c}','carol');`,
  );
});
afterAll(() => db.close());
async function asUser<T = Record<string, unknown>>(user: string, sql: string) {
  await db.exec(
    `begin;set local role authenticated;select set_config('request.jwt.claim.sub','${user}',true);`,
  );
  try {
    const result = await db.query<T>(sql);
    await db.exec("commit");
    return result.rows;
  } catch (e) {
    await db.exec("rollback");
    throw e;
  }
}
async function send() {
  return (
    await asUser<{ id: string }>(
      a,
      `select public.send_friend_request('@BOB') as id`,
    )
  )[0].id;
}
test("request lifecycle, private reads and recipient-only acceptance", async () => {
  const id = await send();
  expect(await asUser(c, "select * from public.friendships")).toEqual([]);
  expect(
    await asUser(
      a,
      `update public.friendships set status='accepted' where id='${id}' returning id`,
    ),
  ).toEqual([]);
  expect(
    (
      await asUser(
        b,
        `update public.friendships set status='accepted' where id='${id}' returning status`,
      )
    )[0].status,
  ).toBe("accepted");
  expect((await asUser(a, "select * from public.friendships")).length).toBe(1);
  await asUser(b, `delete from public.friendships where id='${id}'`);
  expect(await asUser(a, "select * from public.friendships")).toEqual([]);
});
test("cannot bypass acceptance by inserting an accepted friendship or impersonating a sender", async () => {
  await expect(
    asUser(
      a,
      `insert into public.friendships(requester_id,recipient_id,status) values('${a}','${b}','accepted')`,
    ),
  ).rejects.toThrow();
  await expect(
    asUser(
      a,
      `insert into public.friendships(requester_id,recipient_id) values('${b}','${c}')`,
    ),
  ).rejects.toThrow();
});
test("participants and creation time cannot be changed during acceptance", async () => {
  const id = await send();
  await expect(
    asUser(
      b,
      `update public.friendships set status='accepted',requester_id='${c}' where id='${id}'`,
    ),
  ).rejects.toThrow("invalid_friendship_transition");
  await expect(
    asUser(
      b,
      `update public.friendships set status='accepted',created_at=now()+interval '1 day' where id='${id}'`,
    ),
  ).rejects.toThrow("invalid_friendship_transition");
});
test("duplicates and crossed requests remain a single pending request", async () => {
  await send();
  await expect(send()).rejects.toThrow("duplicate key");
  await expect(
    asUser(b, `select public.send_friend_request('alice')`),
  ).rejects.toThrow("duplicate key");
  expect(
    (await asUser(b, "select status from public.friendships"))[0].status,
  ).toBe("pending");
});
test("sender can cancel, recipient can decline, a third person cannot delete", async () => {
  let id = await send();
  expect(
    await asUser(
      c,
      `delete from public.friendships where id='${id}' returning id`,
    ),
  ).toEqual([]);
  await asUser(a, `delete from public.friendships where id='${id}'`);
  id = await send();
  await asUser(b, `delete from public.friendships where id='${id}'`);
  expect(await asUser(a, "select * from public.friendships")).toEqual([]);
});
test("username matching is exact, normalized and excludes oneself", async () => {
  await expect(
    asUser(a, `select public.send_friend_request('bo')`),
  ).rejects.toThrow("unknown_username");
  await expect(
    asUser(a, `select public.send_friend_request('alice')`),
  ).rejects.toThrow("cannot_friend_yourself");
  expect(await send()).toBeTruthy();
});
test("anonymous callers have no table or RPC access", async () => {
  for (const sql of [
    "select * from public.friendships",
    `select public.send_friend_request('bob')`,
  ]) {
    await db.exec("begin;set local role anon;");
    await expect(db.exec(sql)).rejects.toThrow("permission denied");
    await db.exec("rollback");
  }
});
test("pending outgoing requests are capped on the server", async () => {
  await db.exec(
    `insert into public.profiles select ('10000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,'person'||i from generate_series(1,101) i;`,
  );
  await asUser(
    a,
    `insert into public.friendships(requester_id,recipient_id) select '${a}',id from public.profiles where username like 'person%' and username<>'person101'`,
  );
  await expect(
    asUser(a, `select public.send_friend_request('person101')`),
  ).rejects.toThrow("too_many_friend_requests");
});
