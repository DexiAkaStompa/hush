import { afterAll, beforeAll, expect, test } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import migration from "../../supabase/migrations/20261019234856_invite_previews.sql?raw";
const db = new PGlite(),
  user = "00000000-0000-0000-0000-000000000001",
  space = "00000000-0000-0000-0000-000000000002",
  token = "a".repeat(48);
beforeAll(async () => {
  await db.exec(`create role authenticated;create role anon;create schema auth;create schema extensions;
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function extensions.digest(text,text) returns bytea language sql immutable as $$select decode(md5($1),'hex')$$;
    create table public.spaces(id uuid,name text,icon_data text);
    create table public.space_members(space_id uuid,user_id uuid);
    create table public.space_bans(space_id uuid,user_id uuid);
    create table public.space_invites(space_id uuid,token_hash text,revoked_at timestamptz,expires_at timestamptz,use_count int,max_uses int);
    grant usage on schema public,auth to authenticated,anon;
    insert into public.spaces values('${space}','Private server',null);
    insert into public.space_invites values('${space}',md5('${token}'),null,now()+interval '1 day',0,25);`);
  await db.exec(migration.replace(/notify pgrst,'reload schema';/i, ""));
});
afterAll(() => db.close());
async function preview(value: string) {
  await db.exec(
    `begin;set local role authenticated;select set_config('request.jwt.claim.sub','${user}',true);`,
  );
  try {
    const result = await db.query<{ value: unknown }>(
      "select public.get_space_invite_preview($1) as value",
      [value],
    );
    return result.rows[0].value;
  } finally {
    await db.exec("rollback");
  }
}
test("valid bearer token reveals only server identity and counts, without consuming it", async () => {
  expect(await preview(token)).toEqual({
    id: space,
    name: "Private server",
    icon_data: null,
    member_count: 0,
    is_member: false,
  });
  expect(
    (
      await db.query<{ n: number }>(
        "select use_count as n from public.space_invites",
      )
    ).rows[0].n,
  ).toBe(0);
  expect(await preview("b".repeat(48))).toBeNull();
});
test("revoked and exhausted invites do not expose private metadata", async () => {
  await db.exec("update public.space_invites set revoked_at=now()");
  expect(await preview(token)).toBeNull();
  await db.exec("update public.space_invites set revoked_at=null,use_count=25");
  expect(await preview(token)).toBeNull();
  await db.exec("update public.space_invites set use_count=0");
});
test("banned users and anonymous callers cannot inspect a server", async () => {
  await db.exec(`insert into public.space_bans values('${space}','${user}')`);
  expect(await preview(token)).toBeNull();
  await db.exec("begin;set local role anon");
  await expect(
    db.exec(`select public.get_space_invite_preview('${token}')`),
  ).rejects.toThrow("permission denied");
  await db.exec("rollback");
});
