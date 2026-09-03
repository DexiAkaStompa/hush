import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import initialMigration from "../../supabase/migrations/20260821143000_initial.sql?raw";
import authMigration from "../../supabase/migrations/20260821170000_username_password_auth.sql?raw";
import functionalMigrationSource from "../../supabase/migrations/20260821203000_functional_mvp.sql?raw";
import profileRepairMigrationSource from "../../supabase/migrations/20260821210000_profile_repair.sql?raw";
import voiceChannelMigrationSource from "../../supabase/migrations/20260821220000_voice_channels_and_call_topics.sql?raw";
import inviteCryptoFixMigrationSource from "../../supabase/migrations/20260821221000_invite_pgcrypto_schema_fix.sql?raw";
import clientMusicMigrationSource from "../../supabase/migrations/20260821222000_client_music_sync.sql?raw";
import keyEnvelopeRpcMigrationSource from "../../supabase/migrations/20260821223000_key_envelope_rpc_fix.sql?raw";
import userDeletionMigrationSource from "../../supabase/migrations/20260903083330_user_deletion_integrity.sql?raw";

const database = new PGlite();

const initialMigrationWithoutHostedExtension = initialMigration
  .replace(/create extension if not exists pgcrypto;/i, "");

const functionalMigration = functionalMigrationSource
  .replace(/do \$\$ begin\s+alter publication[\s\S]*?end \$\$;/i, "")
  .replace(/notify pgrst, 'reload schema';/i, "");
const profileRepairMigration = profileRepairMigrationSource.replace(/notify pgrst, 'reload schema';/i, "");
const voiceChannelMigration = voiceChannelMigrationSource.replace(/notify pgrst, 'reload schema';/i, "");
const inviteCryptoFixMigration = inviteCryptoFixMigrationSource.replace(/notify pgrst, 'reload schema';/i, "");
const clientMusicMigration = clientMusicMigrationSource.replace(/notify pgrst, 'reload schema';/i, "");
const keyEnvelopeRpcMigration = keyEnvelopeRpcMigrationSource.replace(/notify pgrst, 'reload schema';/i, "");
const userDeletionMigration = userDeletionMigrationSource.replace(/notify pgrst, 'reload schema';/i, "");

describe("Supabase migrations", () => {
  beforeAll(async () => {
    await database.exec(`
      create role authenticated;
      create schema auth;
      create schema extensions;
      create table auth.users (
        id uuid primary key,
        email text,
        raw_user_meta_data jsonb not null default '{}'::jsonb
      );
      create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
      create function extensions.gen_random_bytes(integer) returns bytea language sql stable as $$ select decode(repeat('00', $1), 'hex') $$;
      create function extensions.digest(text, text) returns bytea language sql stable as $$ select decode(md5($1), 'hex') $$;

      create schema realtime;
      create table realtime.messages (extension text);
      create function realtime.topic() returns text language sql stable as $$ select ''::text $$;
    `);
  });

  afterAll(async () => database.close());

  it("applies the complete schema in order", async () => {
    await database.exec(initialMigrationWithoutHostedExtension);
    await database.exec(authMigration);
    await database.exec(functionalMigration);
    await database.exec(profileRepairMigration);
    await database.exec(voiceChannelMigration);
    await database.exec(inviteCryptoFixMigration);
    await database.exec(clientMusicMigration);
    await database.exec(keyEnvelopeRpcMigration);
    await database.exec(userDeletionMigration);
    await database.exec(`
      create function realtime.broadcast_changes(
        text, text, text, name, name, public.encrypted_messages, public.encrypted_messages
      ) returns void language sql as $$ select $$;
    `);

    const result = await database.query<{ table_name: string }>(`
      select table_name
      from information_schema.tables
      where table_schema = 'public'
        and table_name in ('space_invites', 'conversation_key_envelopes', 'conversation_key_requests', 'conversation_music_state')
      order by table_name
    `);
    expect(result.rows.map((row) => row.table_name)).toEqual([
      "conversation_key_envelopes",
      "conversation_key_requests",
      "conversation_music_state",
      "space_invites",
    ]);

    const functionResult = await database.query<{ exists: boolean }>(`
      select exists (
        select 1 from pg_proc
        where pronamespace = 'public'::regnamespace
          and proname = 'create_space_voice_channel'
      ) as exists
    `);
    expect(functionResult.rows[0]?.exists).toBe(true);

    const inviteFunction = await database.query<{ definition: string }>(`
      select pg_get_functiondef('public.create_space_invite(uuid)'::regprocedure) as definition
    `);
    expect(inviteFunction.rows[0]?.definition).toContain("extensions.gen_random_bytes");
    expect(inviteFunction.rows[0]?.definition).toContain("extensions.digest");

    const musicFunction = await database.query<{ exists: boolean }>(`
      select exists (
        select 1 from pg_proc
        where pronamespace = 'public'::regnamespace
          and proname = 'set_conversation_music_state'
      ) as exists
    `);
    expect(musicFunction.rows[0]?.exists).toBe(true);

    const envelopeFunction = await database.query<{ exists: boolean }>(`
      select exists (
        select 1 from pg_proc
        where pronamespace = 'public'::regnamespace
          and proname = 'store_conversation_key_envelopes'
      ) as exists
    `);
    expect(envelopeFunction.rows[0]?.exists).toBe(true);
  }, 20_000);

  it("allows deleting a user while retaining shared content without an author", async () => {
    const userId = "11111111-1111-1111-1111-111111111111";
    const otherUserId = "22222222-2222-2222-2222-222222222222";
    const groupId = "33333333-3333-3333-3333-333333333333";
    const messageId = "44444444-4444-4444-4444-444444444444";
    await database.exec(`
      insert into auth.users (id, email) values ('${userId}', 'deleted@example.test'), ('${otherUserId}', 'member@example.test');
      insert into public.conversations (id, space_id, kind, name, created_by)
      values ('${groupId}', null, 'group_dm', 'shared', '${userId}');
      insert into public.encrypted_messages (id, conversation_id, sender_id, algorithm, nonce, ciphertext)
      values ('${messageId}', '${groupId}', '${userId}', 'AES-256-GCM', 'nonce-value', 'ciphertext-value');
      insert into public.spaces (id, name, owner_id)
      values ('55555555-5555-5555-5555-555555555555', 'owned', '${userId}');
    `);
    await database.exec(`delete from auth.users where id = '${userId}';`);

    const result = await database.query<{ created_by: string | null; sender_id: string | null; owned_space_exists: boolean }>(`
      select
        (select created_by from public.conversations where id = '${groupId}') as created_by,
        (select sender_id from public.encrypted_messages where id = '${messageId}') as sender_id,
        exists(select 1 from public.spaces where id = '55555555-5555-5555-5555-555555555555') as owned_space_exists
    `);
    expect(result.rows[0]).toEqual({ created_by: null, sender_id: null, owned_space_exists: false });
  });
});
