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
});
