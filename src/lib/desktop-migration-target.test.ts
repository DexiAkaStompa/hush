import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({ getSession: vi.fn(), dependencies: {}, run: vi.fn() }));
vi.mock("./supabase", () => ({ supabase: { auth: { getSession: mocked.getSession } } }));
vi.mock("./desktop-migration", () => ({
  productionMigrationTargetDependencies: async () => mocked.dependencies,
  runMigrationTarget: mocked.run,
}));
import { initDesktopMigrationTarget } from "./desktop-migration-target";

const USER = "11111111-2222-4333-8444-555555555555";
let storage: Map<string, string>, bridge: any, message: (value: any) => void,
  targetWindow: EventTarget & { __TAURI_INTERNALS__?: unknown; hushWindow: unknown };
beforeEach(() => {
  storage = new Map(); message = () => {};
  vi.stubGlobal("localStorage", { getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) });
  bridge = { hasDesktopMigrationSource: vi.fn().mockResolvedValue(true), beginDesktopMigration: vi.fn().mockResolvedValue(true),
    sendDesktopMigrationMessage: vi.fn().mockResolvedValue(undefined), finishDesktopMigration: vi.fn().mockResolvedValue(undefined),
    onDesktopMigrationMessage: vi.fn(callback => { message = callback; return vi.fn(); }) };
  targetWindow = Object.assign(new EventTarget(), { __TAURI_INTERNALS__: {}, hushWindow: bridge });
  vi.stubGlobal("window", targetWindow);
  vi.stubGlobal("StorageEvent", class extends Event { key: string; newValue: string; constructor(name: string, options: any) {
    super(name); this.key = options.key; this.newValue = options.newValue;
  } });
  mocked.getSession.mockReset().mockResolvedValue({ data: { session: null }, error: null });
  mocked.run.mockReset().mockImplementation(async () => {
    localStorage.setItem("hush-theme", "nord");
    return { userId: USER, deviceId: "device", conversations: 2, preferenceKeys: ["hush-theme"] };
  });
});
afterEach(() => vi.unstubAllGlobals());

it("skips ordinary browser, Electron and Android contexts without starting a native handoff", async () => {
  delete targetWindow.__TAURI_INTERNALS__;
  expect(await initDesktopMigrationTarget()).toEqual({ status: "skipped" });
  expect(bridge.hasDesktopMigrationSource).not.toHaveBeenCalled();
  expect(mocked.run).not.toHaveBeenCalled();
});
it("does not reopen the original account after an already migrated user logs out", async () => {
  storage.set("hush:desktop-migrated:v1", "1");
  expect(await initDesktopMigrationTarget()).toEqual({ status: "skipped" });
  expect(bridge.hasDesktopMigrationSource).not.toHaveBeenCalled();
});
it("leaves an existing destination login untouched unless a prior migration is pending", async () => {
  mocked.getSession.mockResolvedValue({ data: { session: { user: { id: USER } } }, error: null });
  expect(await initDesktopMigrationTarget()).toEqual({ status: "skipped" });
  expect(bridge.beginDesktopMigration).not.toHaveBeenCalled();
  storage.set("hush:desktop-migration-pending:v1", "1");
  expect(await initDesktopMigrationTarget()).toEqual({ status: "completed" });
  expect(bridge.beginDesktopMigration).toHaveBeenCalledOnce();
});
it("marks completion only after the encrypted/key-verified handoff and updates shared preference listeners", async () => {
  const changed = vi.fn(); targetWindow.addEventListener("storage", changed);
  expect(await initDesktopMigrationTarget()).toEqual({ status: "completed" });
  const hello = bridge.beginDesktopMigration.mock.calls[0][0];
  expect(hello.version).toBe(1); expect(hello.publicKey.d).toBeUndefined();
  expect(JSON.parse(storage.get("hush:desktop-migrated:v1")!).userId).toBe(USER);
  expect(storage.has("hush:desktop-migration-pending:v1")).toBe(false);
  expect(changed).toHaveBeenCalledOnce(); expect(bridge.finishDesktopMigration).toHaveBeenCalledOnce();
});
it("returns a recovery state without marking incomplete history as a successful startup", async () => {
  mocked.run.mockRejectedValue(new Error("secret-internal-token-must-not-be-shown"));
  const result = await initDesktopMigrationTarget();
  expect(result.status).toBe("failed"); expect(result.message).not.toContain("secret-internal");
  expect(storage.get("hush:desktop-migration-pending:v1")).toBe("1");
  expect(storage.has("hush:desktop-migrated:v1")).toBe(false);
  expect(bridge.finishDesktopMigration).not.toHaveBeenCalled();
  expect(bridge.sendDesktopMigrationMessage).toHaveBeenCalledWith({ kind: "cancel" });
});
it("retains pending state if a legacy source disappears or refuses to start", async () => {
  bridge.beginDesktopMigration.mockResolvedValue(false);
  expect((await initDesktopMigrationTarget()).status).toBe("failed");
  expect(storage.get("hush:desktop-migration-pending:v1")).toBe("1");
  bridge.hasDesktopMigrationSource.mockResolvedValue(false);
  expect((await initDesktopMigrationTarget()).status).toBe("failed");
  expect(storage.get("hush:desktop-migration-pending:v1")).toBe("1");
});
it("bounds incoming migration frames instead of retaining an unlimited native event queue", async () => {
  bridge.beginDesktopMigration.mockImplementation(async () => {
    for (let index = 0; index < 5; index++) message({ kind: "sender-key", publicKey: {} });
    return true;
  });
  mocked.run.mockImplementation(async (_receiver, port) => { await port.receive(); throw new Error("unexpected success"); });
  expect((await initDesktopMigrationTarget()).status).toBe("failed");
  expect(bridge.sendDesktopMigrationMessage).toHaveBeenCalledWith({ kind: "cancel" });
});
