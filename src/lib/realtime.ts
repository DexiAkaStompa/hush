import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "./supabase";

export type EncryptedMessageRow = {
  id: string;
  conversation_id: string;
  sender_id: string | null;
  algorithm: "AES-256-GCM" | "MLS-1.0";
  key_epoch: number;
  nonce: string;
  ciphertext: string;
  aad_json: Record<string, unknown>;
  created_at: string;
};

export type WebRtcSignal =
  | { kind: "offer"; sdp: string }
  | { kind: "answer"; sdp: string }
  | { kind: "ice"; candidate: string; sdpMid: string | null; sdpMLineIndex: number | null };

export type RealtimeStatus = "connecting" | "connected" | "disconnected" | "error";

export const conversationTopic = (conversationId: string) => `conversation:${conversationId}`;
export const callTopic = (conversationId: string) => `call:${conversationId}`;

export function extractBroadcastRecord(payload: unknown): EncryptedMessageRow | null {
  if (!payload || typeof payload !== "object") return null;
  const wrapper = payload as Record<string, unknown>;
  const inner = wrapper.payload && typeof wrapper.payload === "object"
    ? wrapper.payload as Record<string, unknown>
    : wrapper;
  const record = inner.record ?? inner.new ?? inner;
  if (!record || typeof record !== "object") return null;
  const candidate = record as Partial<EncryptedMessageRow>;
  return typeof candidate.id === "string" && typeof candidate.ciphertext === "string"
    ? candidate as EncryptedMessageRow
    : null;
}

type ConversationSubscription = {
  conversationId: string;
  userId: string;
  skipPresence?: boolean;
  onMessage: (message: EncryptedMessageRow) => void;
  onPresence: (userIds: string[]) => void;
  onStatus: (status: RealtimeStatus) => void;
};

export async function subscribeToConversation(options: ConversationSubscription) {
  if (!supabase) throw new Error("Supabase non è configurato");
  options.onStatus("connecting");
  await supabase.realtime.setAuth();

  const channel = supabase.channel(conversationTopic(options.conversationId), {
    config: {
      private: true,
      broadcast: { self: false, ack: true },
      presence: { key: options.userId },
    },
  });

  channel
    .on("broadcast", { event: "INSERT" }, (event) => {
      const record = extractBroadcastRecord(event);
      if (record) options.onMessage(record);
    })
    .on("presence", { event: "sync" }, () => {
      options.onPresence(Object.keys(channel.presenceState()));
    })
    .subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        options.onStatus("connected");
        if (!options.skipPresence) {
          await channel.track({ userId: options.userId, onlineAt: new Date().toISOString() });
        }
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        options.onStatus("error");
      } else if (status === "CLOSED") {
        options.onStatus("disconnected");
      }
    });

  return channel;
}

export async function unsubscribeFromConversation(channel: RealtimeChannel) {
  if (!supabase) return;
  await supabase.removeChannel(channel);
}

export async function persistEncryptedMessage(
  message: Omit<EncryptedMessageRow, "created_at">,
) {
  if (!supabase) throw new Error("Supabase non è configurato");
  const { error } = await supabase.from("encrypted_messages").insert(message);
  if (error) throw error;
}

export type IncomingCallPayload = {
  conversationId: string;
  conversationName: string;
  caller: {
    id: string;
    display_name: string;
    username: string;
    avatar_color: string;
    avatar_path?: string | null;
  };
  isVideo: boolean;
  timestamp: number;
};

export async function broadcastIncomingCall(payload: IncomingCallPayload) {
  if (!supabase) return;
  const channel = supabase.channel(callTopic(payload.conversationId), {
    config: { private: true, broadcast: { self: false } },
  });
  await channel.subscribe();
  await channel.send({
    type: "broadcast",
    event: "call:incoming",
    payload,
  });
}

export async function broadcastCallCancelled(conversationId: string) {
  if (!supabase) return;
  const channel = supabase.channel(callTopic(conversationId), {
    config: { private: true, broadcast: { self: false } },
  });
  await channel.subscribe();
  await channel.send({
    type: "broadcast",
    event: "call:cancelled",
    payload: { conversationId },
  });
}

export function subscribeToIncomingCalls(
  conversationIds: string[],
  userId: string,
  onIncomingCall: (call: IncomingCallPayload) => void,
  onCallCancelled?: (conversationId: string) => void
): () => void {
  if (!supabase || conversationIds.length === 0) return () => {};
  const client = supabase;
  const channels = conversationIds.map((id) => {
    const channel = client.channel(callTopic(id), {
      config: { private: true, broadcast: { self: false } },
    });
    channel
      .on("broadcast", { event: "call:incoming" }, (event) => {
        const payload = event.payload as IncomingCallPayload;
        if (payload && payload.caller && payload.caller.id !== userId) {
          onIncomingCall(payload);
        }
      })
      .on("broadcast", { event: "call:cancelled" }, (event) => {
        const payload = event.payload as { conversationId: string };
        if (payload && payload.conversationId) {
          onCallCancelled?.(payload.conversationId);
        }
      });
    channel.subscribe();
    return channel;
  });

  return () => {
    channels.forEach((ch) => {
      void client.removeChannel(ch);
    });
  };
}

export function subscribeToBackgroundMessages(
  conversationIds: string[],
  userId: string,
  onMessage: (message: EncryptedMessageRow) => void
): () => void {
  if (!supabase || conversationIds.length === 0) return () => {};
  const client = supabase;
  const channels = conversationIds.map((id) => {
    const channel = client.channel(conversationTopic(id), {
      config: { private: true, broadcast: { self: false } },
    });
    channel.on("broadcast", { event: "INSERT" }, (event) => {
      const record = extractBroadcastRecord(event);
      if (record && record.sender_id !== userId) {
        onMessage(record);
      }
    });
    channel.subscribe();
    return channel;
  });

  return () => {
    channels.forEach((ch) => {
      void client.removeChannel(ch);
    });
  };
}

