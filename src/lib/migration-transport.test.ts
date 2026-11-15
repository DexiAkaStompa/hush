import { afterEach, expect, it, vi } from "vitest";
import { createMigrationReceiver, createMigrationSource, migrationBytes, MIGRATION_FRAME_BYTES,
  MIGRATION_LIFETIME_MS, validateMigrationHello } from "./migration-transport";

afterEach(() => vi.restoreAllMocks());
async function pair() {
  const target = await createMigrationReceiver();
  const source = await createMigrationSource(target.hello);
  return { hello: target.hello, source: source.channel, target: await target.connect(source.publicKey) };
}
it("transfers session data in both directions without exposing it in serialized wire frames", async () => {
  const { source, target } = await pair();
  const payload = { kind: "snapshot", session: { access_token: "private-session-value", refresh_token: "private-refresh-value" } };
  const frame = await source.seal(payload);
  expect(JSON.stringify(frame)).not.toContain("private-session");
  expect(await target.open(frame)).toEqual(payload);
  const reply = { kind: "target-ready", userId: "same-account", deviceId: "new-device" };
  expect(await source.open(await target.seal(reply))).toEqual(reply);
  source.dispose(); target.dispose();
});
it("rejects tampering, replay, reordered messages and frames from another transfer", async () => {
  const first = await pair(), other = await pair();
  const frame = await first.source.seal({ hello: "history" });
  await expect(first.target.open({ ...frame, sequence: 1 })).rejects.toThrow("Sequenza");
  const corrupted = { ...frame, ciphertext: (frame.ciphertext[0] === "A" ? "B" : "A") + frame.ciphertext.slice(1) };
  await expect(first.target.open(corrupted)).rejects.toThrow();
  await expect(other.target.open(frame)).rejects.toThrow("Sequenza");
  expect(await first.target.open(frame)).toEqual({ hello: "history" });
  await expect(first.target.open(frame)).rejects.toThrow("Sequenza");
  for (const item of [first, other]) { item.source.dispose(); item.target.dispose(); }
});
it("uses direction-separated keys so reflected frames cannot authenticate", async () => {
  const { source, target } = await pair();
  const frame = await source.seal({ kind: "snapshot" });
  await expect(source.open(frame)).rejects.toThrow();
  expect(await target.open(frame)).toEqual({ kind: "snapshot" });
});
it("rejects expired handshakes and fails closed once a live channel expires or is disposed", async () => {
  const { hello, source, target } = await pair();
  const frame = await source.seal({ kind: "snapshot" });
  vi.spyOn(Date, "now").mockReturnValue(hello.expiresAt);
  expect(() => validateMigrationHello(hello)).toThrow("scaduta");
  await expect(target.open(frame)).rejects.toThrow("scaduto");
  await expect(source.seal({})).rejects.toThrow("scaduto");
  source.dispose(); target.dispose();
  vi.restoreAllMocks();
  await expect(target.open(frame)).rejects.toThrow("chiuso");
});
it("bounds plaintext and ciphertext frames before decryption", async () => {
  const { source, target } = await pair();
  await expect(source.seal({ data: "x".repeat(MIGRATION_FRAME_BYTES) })).rejects.toThrow("grande");
  const frame = await source.seal({ data: "valid" });
  await expect(target.open({ ...frame, ciphertext: "A".repeat(Math.ceil((MIGRATION_FRAME_BYTES + 17) / 3) * 4 + 4) }))
    .rejects.toThrow();
  expect(await target.open(frame)).toEqual({ data: "valid" });
  expect(() => migrationBytes("not base64", 10)).toThrow();
});
it("validates recipient key material and permits one source connection per receiver", async () => {
  const target = await createMigrationReceiver();
  expect(() => validateMigrationHello({ ...target.hello, expiresAt: Date.now() + MIGRATION_LIFETIME_MS * 2 })).toThrow();
  expect(() => validateMigrationHello({ ...target.hello, publicKey: { ...target.hello.publicKey, d: "private" } })).toThrow();
  const source = await createMigrationSource(target.hello);
  await target.connect(source.publicKey);
  await expect(target.connect(source.publicKey)).rejects.toThrow("già collegato");
});
