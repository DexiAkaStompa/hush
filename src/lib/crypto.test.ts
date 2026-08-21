import { describe, expect, it } from "vitest";
import {
  createRoomKey,
  decryptText,
  encryptText,
  getKeyFingerprint,
} from "./crypto";

describe("room encryption", () => {
  it("round-trips unicode text", async () => {
    const key = await createRoomKey();
    const payload = await encryptText("Ciao, ci vediamo alle 21? 🔒", key, "room:general");

    await expect(decryptText(payload, key, "room:general")).resolves.toBe(
      "Ciao, ci vediamo alle 21? 🔒",
    );
  });

  it("binds ciphertext to its room context", async () => {
    const key = await createRoomKey();
    const payload = await encryptText("segreto", key, "room:a");

    await expect(decryptText(payload, key, "room:b")).rejects.toThrow();
  });

  it("creates a readable stable fingerprint", async () => {
    const key = await createRoomKey();
    const fingerprint = await getKeyFingerprint(key);

    expect(fingerprint).toMatch(/^[0-9A-F]{4}( [0-9A-F]{4}){4}$/);
  });
});
