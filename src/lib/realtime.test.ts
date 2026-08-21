import { describe, expect, it } from "vitest";
import { callTopic, conversationTopic, extractBroadcastRecord } from "./realtime";

describe("Supabase Realtime adapter", () => {
  it("uses a granular topic per conversation", () => {
    expect(conversationTopic("abc")).toBe("conversation:abc");
    expect(callTopic("abc")).toBe("call:abc");
    expect(callTopic("abc")).not.toBe(conversationTopic("abc"));
  });

  it("extracts a database broadcast record", () => {
    const record = extractBroadcastRecord({
      payload: {
        new: {
          id: "message-1",
          conversation_id: "conversation-1",
          sender_id: "user-1",
          algorithm: "AES-256-GCM",
          key_epoch: 0,
          nonce: "nonce",
          ciphertext: "ciphertext",
          aad_json: {},
          created_at: "2026-08-21T00:00:00Z",
        },
      },
    });

    expect(record?.id).toBe("message-1");
    expect(record?.ciphertext).toBe("ciphertext");
  });
});
