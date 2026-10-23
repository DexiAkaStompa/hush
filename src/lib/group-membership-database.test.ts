import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import source from "../../supabase/migrations/20261023210645_group_membership_management.sql?raw";
const db = new PGlite();
const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12,"0")}`;
beforeAll(async () => {
  await db.exec(`create role authenticated;create role anon;create schema auth;
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create table conversations(id uuid primary key,kind text,space_id uuid,created_by uuid,identity_customized boolean);
    create table profiles(id uuid primary key,username text unique);
    create table conversation_members(conversation_id uuid,user_id uuid,joined_at timestamptz default now(),left_at timestamptz,primary key(conversation_id,user_id));
    create table devices(id uuid primary key,user_id uuid,revoked_at timestamptz);
    create table conversation_key_requests(conversation_id uuid,requester_device_id uuid,primary key(conversation_id,requester_device_id));
    create table conversation_key_envelopes(conversation_id uuid,recipient_device_id uuid);
    create function public.is_conversation_member(cid uuid) returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.conversation_members where conversation_id=cid and user_id=auth.uid() and left_at is null)$$;
    grant usage on schema public,auth to authenticated,anon;`);
  await db.exec(source.split("-- Existing table")[0]);
});
beforeEach(async () => {
  await db.exec(`truncate conversations,profiles,conversation_members,devices,conversation_key_requests,conversation_key_envelopes;
    insert into conversations values('${id(10)}','group_dm',null,'${id(1)}',true);
    insert into profiles values('${id(1)}','owner'),('${id(2)}','member'),('${id(3)}','newfriend'),('${id(4)}','outsider');
    insert into conversation_members(conversation_id,user_id) values('${id(10)}','${id(1)}'),('${id(10)}','${id(2)}');
    insert into devices values('${id(20)}','${id(3)}',null),('${id(21)}','${id(3)}',now()),('${id(22)}','${id(1)}',null);`);
});
afterAll(() => db.close());
async function asUser(user: number, query: string, role="authenticated") {
  await db.exec(`begin;set local role ${role};select set_config('request.jwt.claim.sub','${id(user)}',true);`);
  try { const rows = (await db.query(query)).rows; await db.exec("commit"); return rows; }
  catch (error) { await db.exec("rollback"); throw error; }
}
const add = (names="array['@NEWFRIEND','newfriend']") => `select add_group_members('${id(10)}',${names}) as added`;
test("members can add people once and request keys only for active devices", async () => {
  expect(await asUser(2,add())).toEqual([{added:1}]);
  expect(await asUser(2,add())).toEqual([{added:0}]);
  expect((await db.query("select requester_device_id from conversation_key_requests")).rows).toEqual([{requester_device_id:id(20)}]);
});
test("outsiders, departed members and anonymous callers cannot invite", async () => {
  await expect(asUser(4,add())).rejects.toThrow("not_conversation_member");
  await db.exec(`update conversation_members set left_at=now() where user_id='${id(2)}'`);
  await expect(asUser(2,add())).rejects.toThrow("not_conversation_member");
  await expect(asUser(1,add(),"anon")).rejects.toThrow("permission denied");
});
test("unknown usernames abort the whole batch and private DMs cannot be expanded", async () => {
  await expect(asUser(1,add("array['newfriend','missing']"))).rejects.toThrow("unknown_username");
  expect((await db.query("select * from conversation_members")).rows).toHaveLength(2);
  await db.exec("update conversations set identity_customized=false");
  await expect(asUser(1,add())).rejects.toThrow("not_editable_group");
});
test("enforces the total group size including current members", async () => {
  for(let n=30;n<53;n++) await db.query("insert into conversation_members(conversation_id,user_id) values($1,$2)",[id(10),id(n)]);
  await expect(asUser(1,add())).rejects.toThrow("group_member_limit");
});
test("leaving transfers ownership, revokes key delivery and supports rejoining", async () => {
  await db.exec(`insert into conversation_key_envelopes values('${id(10)}','${id(22)}');insert into conversation_key_requests values('${id(10)}','${id(22)}')`);
  await asUser(1,`select leave_group_dm('${id(10)}')`);
  expect((await db.query("select created_by from conversations")).rows).toEqual([{created_by:id(2)}]);
  expect((await db.query("select * from conversation_key_envelopes")).rows).toHaveLength(0);
  expect((await db.query("select * from conversation_key_requests")).rows).toHaveLength(0);
  await expect(asUser(1,add())).rejects.toThrow("not_conversation_member");
  expect(await asUser(2,add("array['owner']"))).toEqual([{added:1}]);
});
