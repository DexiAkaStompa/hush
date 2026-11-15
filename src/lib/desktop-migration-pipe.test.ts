import { createRequire } from "node:module";
import { EventEmitter } from "node:events";
import { expect, it, vi } from "vitest";
import { createMigrationReceiver } from "./migration-transport";

const { registerDeviceMigration, migrationArguments, migrationArgumentsForSecondInstance, MAX_LINE_BYTES } = createRequire(import.meta.url)("../../electron/device-migration.cjs");
const PIPE = "HushMigration-11111111-2222-4333-8444-555555555555", TOKEN = "a".repeat(43);
function fixture() {
  const handlers = new Map<string, (...args: any[]) => any>();
  const window = { isDestroyed: () => false, webContents: { send: vi.fn() } };
  const event = { trusted: true }, onFinished = vi.fn();
  const socket = new EventEmitter() as any;
  socket.destroyed = false;
  socket.destroy = vi.fn(() => { socket.destroyed = true; socket.emit("close"); });
  socket.write = vi.fn((line, callback) => { socket.written.push(JSON.parse(line)); callback(); });
  socket.written = [];
  const connect = vi.fn(() => socket);
  const migration = registerDeviceMigration({
    platform: "win32", ipcMain: { handle: (name: string, handler: (...args: any[]) => any) => handlers.set(name, handler) },
    windowForEvent: (value: unknown) => value === event ? window : null, getWindow: () => window,
    onFinished, connect,
  });
  const begin = () => migration.beginFromArguments(["Hush.exe", `--hush-migration-pipe=${PIPE}`, `--hush-migration-token=${TOKEN}`]);
  const data = (value: unknown) => socket.emit("data", Buffer.from(JSON.stringify(value) + "\n"));
  return { handlers, window, event, onFinished, socket, connect, migration, begin, data };
}
it("accepts only the fixed named-pipe namespace with one random authentication token", () => {
  expect(migrationArguments(["Hush.exe"])).toBeNull();
  expect(migrationArguments([`--hush-migration-pipe=${PIPE}`, `--hush-migration-token=${TOKEN}`])).toEqual({ pipe: PIPE, token: TOKEN });
  for (const args of [
    [`--hush-migration-pipe=../../bad`, `--hush-migration-token=${TOKEN}`],
    [`--hush-migration-pipe=${PIPE}`, "--hush-migration-token=short"],
    [`--hush-migration-pipe=${PIPE}`, `--hush-migration-token=${TOKEN}`, `--hush-migration-token=${TOKEN}`],
  ]) expect(() => migrationArguments(args)).toThrow();
});
it("restores validated migration flags from additionalData when Chromium changes second-instance argv", () => {
  const argv = ["Hush.exe", "--original-process-start-time=123"];
  const restored = migrationArgumentsForSecondInstance(argv, { hushMigration: { pipe: PIPE, token: TOKEN } });
  expect(migrationArguments(restored)).toEqual({ pipe: PIPE, token: TOKEN });
  expect(migrationArgumentsForSecondInstance(argv, { hushMigration: { pipe: "remote-file", token: TOKEN } })).toEqual(argv);
  expect(migrationArgumentsForSecondInstance(argv, undefined)).toEqual(argv);
});
it("authenticates the OS pipe and forwards only a bounded public-key handshake to the trusted main window", async () => {
  const test = fixture(), receiver = await createMigrationReceiver();
  expect(test.begin()).toBe(true);
  expect(test.connect).toHaveBeenCalledWith({ path: "\\\\.\\pipe\\" + PIPE });
  test.socket.emit("connect");
  expect(test.socket.written).toEqual([{ kind: "authenticate", token: TOKEN }]);
  test.data({ kind: "request", hello: receiver.hello });
  expect(test.handlers.get("migration:get-request")!(test.event)).toEqual(receiver.hello);
  expect(test.window.webContents.send).toHaveBeenCalledWith("migration:message", { kind: "request", hello: receiver.hello });
  expect(() => test.handlers.get("migration:get-request")!({})).toThrow("non autorizzata");
  test.migration.abort();
});
it("rejects child/remote renderer send requests and arbitrary unencrypted payloads", async () => {
  const test = fixture(), receiver = await createMigrationReceiver();
  test.begin(); test.data({ kind: "request", hello: receiver.hello });
  await expect(test.handlers.get("migration:send")!({}, { kind: "sender-key", publicKey: receiver.hello.publicKey })).rejects.toThrow("non autorizzato");
  await expect(test.handlers.get("migration:send")!(test.event, { session: "must-not-forward" })).rejects.toThrow("non valido");
  await test.handlers.get("migration:send")!(test.event, { kind: "sender-key", publicKey: receiver.hello.publicKey });
  await expect(test.handlers.get("migration:send")!(test.event, { kind: "sender-key", publicKey: receiver.hello.publicKey })).rejects.toThrow("non valida");
  test.migration.abort();
});
it("bounds incomplete pipe lines and closes malformed or unexpected inbound traffic", async () => {
  const oversized = fixture(); oversized.begin();
  oversized.socket.emit("data", Buffer.alloc(MAX_LINE_BYTES + 1, 65));
  expect(oversized.socket.destroy).toHaveBeenCalledOnce();
  const malformed = fixture(); malformed.begin(); malformed.socket.emit("data", Buffer.from("not-json\n"));
  expect(malformed.socket.destroy).toHaveBeenCalledOnce();
  const frameBeforeHandshake = fixture(); frameBeforeHandshake.begin(); frameBeforeHandshake.data({ kind: "frame", frame: {} });
  expect(frameBeforeHandshake.socket.destroy).toHaveBeenCalledOnce();
});
it("parses a request split across socket chunks and invokes completion only for the trusted owner", async () => {
  const test = fixture(), receiver = await createMigrationReceiver(); test.begin();
  const line = Buffer.from(JSON.stringify({ kind: "request", hello: receiver.hello }) + "\n");
  test.socket.emit("data", line.subarray(0, 50)); test.socket.emit("data", line.subarray(50));
  expect(test.handlers.get("migration:get-request")!(test.event)).toEqual(receiver.hello);
  await expect(test.handlers.get("migration:finish")!(test.event)).rejects.toThrow("incompleto");
  await test.handlers.get("migration:send")!(test.event, { kind: "sender-key", publicKey: receiver.hello.publicKey });
  await test.handlers.get("migration:finish")!(test.event);
  expect(test.socket.written.at(-1)).toEqual({ kind: "complete" });
  expect(test.onFinished).toHaveBeenCalledOnce();
  expect(test.migration.hasPendingMigration()).toBe(false);
});
