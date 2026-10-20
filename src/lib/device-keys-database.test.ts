import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import migration from "../../supabase/migrations/20261020182659_device_key_reconciliation.sql?raw";
import store from "../../supabase/migrations/20260821223000_key_envelope_rpc_fix.sql?raw";

const db = new PGlite();
const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const owner = id(1), peer = id(2), outsider = id(3), room = id(10), pc = id(20), phone = id(21), other = id(22);
beforeAll(async () => {
  await db.exec(`create role authenticated; create role anon; create schema auth;
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create table conversations(id uuid primary key, created_by uuid);
    create table devices(id uuid primary key, user_id uuid, revoked_at timestamptz);
    create table conversation_members(conversation_id uuid,user_id uuid,left_at timestamptz);
    create table conversation_key_envelopes(conversation_id uuid,recipient_device_id uuid,sender_device_id uuid,
      key_epoch bigint,ephemeral_public_key jsonb,nonce text,ciphertext text, primary key(conversation_id,recipient_device_id,key_epoch));
    create function public.is_conversation_member(cid uuid) returns boolean language sql stable security definer set search_path='' as $$
      select exists(select 1 from public.conversation_members where conversation_id=cid and user_id=auth.uid() and left_at is null)$$;
    grant usage on schema public,auth to authenticated,anon;`);
  await db.exec(store);
  await db.exec(migration);
});
beforeEach(async () => {
  await db.exec(`truncate conversation_key_envelopes,conversations,devices,conversation_members;
    insert into conversations values('${room}','${owner}');
    insert into devices values('${pc}','${owner}',null),('${phone}','${owner}',null),('${other}','${peer}',null);
    insert into conversation_members values('${room}','${owner}',null),('${room}','${peer}',null);`);
});
afterAll(() => db.close());
async function asUser(user: string, query: string, role = "authenticated") {
  await db.exec(`begin;set local role ${role};select set_config('request.jwt.claim.sub','${user}',true);`);
  try { const result = await db.query(query); await db.exec("commit"); return result.rows; }
  catch (e) { await db.exec("rollback"); throw e; }
}
function envelope(device = pc, conversation = room, epoch = 0) {
  return { conversation_id: conversation, recipient_device_id: device, sender_device_id: pc,
    key_epoch: epoch, ephemeral_public_key: {}, nonce: "testnonce", ciphertext: "encrypted-key" };
}
const init = (items = [envelope()]) => `select initialize_conversation_key_envelopes('${room}','${JSON.stringify(items)}'::jsonb) as count`;

test("a new device cannot initialize a second key in an existing conversation", async () => {
  expect(await asUser(owner, init())).toEqual([{ count: 1 }]);
  expect(await asUser(owner, init([envelope(phone)]))).toEqual([{ count: 0 }]);
  expect((await db.query("select * from conversation_key_envelopes")).rows).toHaveLength(1);
});
test("initialization checks creator, membership, authentication and the entire batch", async () => {
  await expect(asUser(peer, init())).rejects.toThrow("not_conversation_creator");
  await expect(asUser(outsider, init())).rejects.toThrow("not_conversation_creator");
  await expect(asUser(owner, init(), "anon")).rejects.toThrow("permission denied");
  await expect(asUser(owner, init([envelope(), envelope(phone, id(99))]))).rejects.toThrow("invalid_key_envelopes");
  await expect(asUser(owner, init([envelope(pc, room, 5)]))).rejects.toThrow("invalid_key_envelopes");
  expect((await db.query("select * from conversation_key_envelopes")).rows).toHaveLength(0);
});
test("missing slots exclude existing envelopes, revoked devices and departed members", async () => {
  await asUser(owner, init());
  await db.exec(`update devices set revoked_at=now() where id='${phone}';update conversation_members set left_at=now() where user_id='${peer}'`);
  expect(await asUser(owner, `select * from missing_conversation_key_envelopes('${room}',array[0,123]::bigint[])`))
    .toEqual([{ recipient_device_id: pc, key_epoch: 123 }]);
  await expect(asUser(outsider, `select * from missing_conversation_key_envelopes('${room}',array[0]::bigint[])`))
    .rejects.toThrow("not_conversation_member");
});
