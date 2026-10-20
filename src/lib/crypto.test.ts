import { describe, expect, it } from "vitest";
import {
  createRoomKey,
  decryptBinary,
  decryptText,
  encryptBinary,
  encryptText,
  getKeyFingerprint,
  registerRoomKeyRing,
} from "./crypto";

describe("room encryption", () => {
  it("recovers text and attachments from both sides of a historical device split", async () => {
    const pc = await createRoomKey(), phone = await createRoomKey(), stranger = await createRoomKey();
    const pcMessage = await encryptText("dal PC", pc, "chat:split");
    const phoneMessage = await encryptText("dal telefono", phone, "chat:split");
    const bytes = new Uint8Array([1, 2, 3, 255]);
    const file = await encryptBinary(bytes.buffer, phone, "file:split");
    registerRoomKeyRing(pc, [pc, phone], "pc,phone");
    registerRoomKeyRing(phone, [pc, phone], "pc,phone");
    await expect(decryptText(pcMessage, phone, "chat:split")).resolves.toBe("dal PC");
    await expect(decryptText(phoneMessage, pc, "chat:split")).resolves.toBe("dal telefono");
    expect(new Uint8Array(await decryptBinary(file.ciphertext, file.iv, pc, "file:split"))).toEqual(bytes);
    await expect(decryptText(phoneMessage, pc, "other-chat")).rejects.toThrow();
    await expect(decryptText(phoneMessage, stranger, "chat:split")).rejects.toThrow();
    const fresh = await encryptText("nuovo", pc, "chat:split");
    await expect(decryptText(fresh, phone, "chat:split")).resolves.toBe("nuovo");
  });
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

  it("round-trips binary image bytes and binds to context", async () => {
    const key = await createRoomKey();
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
    const { iv, ciphertext } = await encryptBinary(bytes.buffer, key, "context:chat:image");

    const decrypted = await decryptBinary(ciphertext, iv, key, "context:chat:image");
    expect(new Uint8Array(decrypted)).toEqual(bytes);

    await expect(decryptBinary(ciphertext, iv, key, "context:chat:wrong")).rejects.toThrow();
  });
});
