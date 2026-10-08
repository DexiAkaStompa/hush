import { supabase } from "./supabase";

function client() {
  if (!supabase) throw new Error("Supabase non è configurato");
  return supabase;
}

export type MessageExtras = {
  reactions: Array<{ message_id: string; user_id: string; emoji: string }>;
  pins: Array<{ message_id: string; pinned_by: string }>;
};

export type ConversationUnread = { conversation_id: string; unread_count: number; last_read_at: string | null };

export async function markConversationRead(conversationId: string, readAt = new Date().toISOString()) {
  const { data, error } = await client().rpc("mark_conversation_read", { p_conversation_id: conversationId, p_read_at: readAt });
  if (error) throw error;
  return data;
}

export async function getConversationUnreads(conversationIds: string[]): Promise<ConversationUnread[]> {
  if (conversationIds.length === 0) return [];
  const { data, error } = await client().rpc("get_conversation_unreads", { p_conversation_ids: conversationIds.slice(0, 500) });
  if (error) throw error;
  return (data ?? []) as ConversationUnread[];
}

export async function loadMessageExtras(conversationId: string): Promise<MessageExtras> {
  const db = client();
  const [reactions, pins] = await Promise.all([
    db.from("message_reactions").select("message_id, user_id, emoji").eq("conversation_id", conversationId),
    db.from("message_pins").select("message_id, pinned_by").eq("conversation_id", conversationId),
  ]);
  if (reactions.error) throw reactions.error;
  if (pins.error) throw pins.error;
  return { reactions: reactions.data ?? [], pins: pins.data ?? [] };
}

export async function toggleMessageReaction(messageId: string, emoji: string) {
  if (typeof emoji !== "string" || emoji.length < 1 || emoji.length > 32) throw new Error("Emoji non valido");
  const { data, error } = await client().rpc("toggle_message_reaction", { p_message_id: messageId, p_emoji: emoji });
  if (error) throw error;
  return Boolean(data);
}

export async function toggleMessagePin(messageId: string) {
  const { data, error } = await client().rpc("toggle_message_pin", { p_message_id: messageId });
  if (error) throw error;
  return Boolean(data);
}

export async function updateEncryptedMessage(
  messageId: string,
  payload: { nonce: string; ciphertext: string; aad_json: Record<string, unknown> },
) {
  const { data, error } = await client().rpc("update_encrypted_message", {
    p_message_id: messageId,
    p_nonce: payload.nonce,
    p_ciphertext: payload.ciphertext,
    p_aad_json: payload.aad_json,
  });
  if (error) throw error;
  return data;
}

export async function deleteEncryptedMessage(messageId: string) {
  const { data, error } = await client().rpc("delete_encrypted_message", { p_message_id: messageId });
  if (error) throw error;
  return Boolean(data);
}
