import { decryptText, type EncryptedPayload } from "./crypto";
import { supabase } from "./supabase";
import type { EncryptedMessageRow } from "./realtime";

export type Profile = {
  id: string;
  username: string;
  display_name: string;
  avatar_color: string;
  avatar_path?: string | null;
  banner_path?: string | null;
  bio?: string;
};

export type Space = {
  id: string;
  name: string;
  owner_id: string;
};

export type Conversation = {
  id: string;
  space_id: string | null;
  kind: "channel" | "voice_channel" | "group_dm";
  name: string;
  created_by: string | null;
};

export type DecryptedMessage = {
  id: string;
  senderId: string | null;
  author: string;
  initials: string;
  body: string;
  createdAt: string;
  encrypted: EncryptedPayload;
};

export function initialsFor(value: string) {
  const words = value.trim().split(/\s+/).filter(Boolean);
  return words.length === 0 ? "TU" : words.slice(0, 2).map((word) => word[0]).join("").toUpperCase();
}

function requireClient() {
  if (!supabase) throw new Error("Supabase non è configurato");
  return supabase;
}

export async function loadWorkspace(userId: string, fallbackProfile?: Profile) {
  const client = requireClient();
  const [profileResult, spacesResult, dmResult] = await Promise.all([
    client.from("profiles").select("*").eq("id", userId).maybeSingle(),
    client.from("spaces").select("id, name, owner_id").order("created_at", { ascending: true }),
    client.from("conversations").select("id, space_id, kind, name, created_by").eq("kind", "group_dm").order("created_at", { ascending: true }),
  ]);
  const error = profileResult.error ?? spacesResult.error ?? dmResult.error;
  if (error) throw error;
  let profile = profileResult.data as Profile | null;
  if (!profile && fallbackProfile) {
    const { data: repairedProfile, error: repairError } = await client.rpc("ensure_profile", {
      p_username: fallbackProfile.username,
      p_display_name: fallbackProfile.display_name,
    });
    if (!repairError && repairedProfile) profile = repairedProfile as Profile;
    if (repairError && repairError.code !== "PGRST202") throw repairError;
  }
  return {
    profile: profile ?? fallbackProfile ?? {
      id: userId,
      username: "utente",
      display_name: "Utente",
      avatar_color: "#73b7ff",
    },
    spaces: (spacesResult.data ?? []) as Space[],
    directMessages: (dmResult.data ?? []) as Conversation[],
  };
}

export async function loadChannels(spaceId: string) {
  const { data, error } = await requireClient()
    .from("conversations")
    .select("id, space_id, kind, name, created_by")
    .eq("space_id", spaceId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as Conversation[];
}

export async function loadConversationMembers(conversationId: string) {
  const client = requireClient();
  const { data: memberships, error } = await client
    .from("conversation_members")
    .select("user_id")
    .eq("conversation_id", conversationId)
    .is("left_at", null);
  if (error) throw error;
  const userIds = (memberships ?? []).map((membership) => membership.user_id as string);
  if (userIds.length === 0) return [];
  const { data: profiles, error: profileError } = await client
    .from("profiles")
    .select("*")
    .in("id", userIds);
  if (profileError) throw profileError;
  return (profiles ?? []) as Profile[];
}

export async function loadAndDecryptMessages(
  conversationId: string,
  key: CryptoKey,
  profiles: Profile[],
) {
  const { data, error } = await requireClient()
    .from("encrypted_messages")
    .select("id, conversation_id, sender_id, algorithm, key_epoch, nonce, ciphertext, aad_json, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true })
    .limit(200);
  if (error) throw error;
  const profileById = new Map(profiles.map((profile) => [profile.id, profile]));
  const context = `hush:conversation:${conversationId}:epoch:0`;
  return Promise.all(((data ?? []) as EncryptedMessageRow[]).map(async (row) => {
    const profile = row.sender_id ? profileById.get(row.sender_id) : undefined;
    const encrypted = { v: 1 as const, iv: row.nonce, ciphertext: row.ciphertext };
    let body = "Messaggio non decifrabile con la chiave corrente.";
    try { body = await decryptText(encrypted, key, context); } catch { /* keep explicit failure */ }
    return {
      id: row.id,
      senderId: row.sender_id,
      author: profile?.display_name ?? "Utente eliminato",
      initials: initialsFor(profile?.display_name ?? "Utente eliminato"),
      body,
      createdAt: row.created_at,
      encrypted,
    } satisfies DecryptedMessage;
  }));
}

export function readableError(error: unknown) {
  const candidate = error && typeof error === "object" ? error as {
    message?: unknown;
    details?: unknown;
    hint?: unknown;
    code?: unknown;
  } : null;
  const message = error instanceof Error
    ? error.message
    : typeof candidate?.message === "string"
      ? candidate.message
      : "Errore Supabase non specificato.";
  const code = typeof candidate?.code === "string" ? candidate.code : "";
  const details = typeof candidate?.details === "string" ? candidate.details : "";
  const hint = typeof candidate?.hint === "string" ? candidate.hint : "";
  const translations: Record<string, string> = {
    invalid_space_name: "Il nome del server deve contenere da 1 a 80 caratteri.",
    invalid_channel_name: "Il nome del canale non è valido.",
    channel_already_exists: "Esiste già un canale con questo nome.",
    unknown_username: "Almeno uno degli username indicati non esiste.",
    invalid_member_count: "Aggiungi da 1 a 24 persone.",
    invalid_or_expired_invite: "Questo invito non è valido oppure è scaduto.",
    owner_cannot_leave: "Il proprietario non può lasciare il server: può eliminarlo dalle impostazioni.",
    not_space_admin: "Solo proprietari e amministratori possono eseguire questa azione.",
    not_space_owner: "Solo il proprietario può eliminare il server.",
  };
  const key = Object.keys(translations).find((candidate) => message.includes(candidate));
  if (key) return translations[key];
  if (code === "PGRST202" || message.toLowerCase().includes("could not find the function")) {
    if (message.includes("create_space_voice_channel")) {
      return "I canali vocali non sono ancora attivi: applica la migrazione 20260821220000_voice_channels_and_call_topics.sql nel SQL Editor.";
    }
    return "La funzione Supabase non esiste ancora: applica la migrazione 20260821203000_functional_mvp.sql nel SQL Editor.";
  }
  if (code === "42883" && (message.includes("gen_random_bytes") || message.includes("digest"))) {
    return "La funzione crittografica degli inviti non è risolta: applica la migrazione 20260821221000_invite_pgcrypto_schema_fix.sql nel SQL Editor.";
  }
  const context = [details, hint].filter(Boolean).join(" ");
  return `${message}${code ? ` [${code}]` : ""}${context ? ` — ${context}` : ""}`;
}
