import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";

function desktopHarness({ rust = false, migrated = false } = {}) {
  const handlers = new Map<string, (...args: any[]) => any>();
  const clipboard = { writeText: vi.fn() };
  const nativeTheme = { themeSource: "system" };
  const setWindowMaterial = vi.fn((_window: unknown, enabled: boolean) => enabled);
  const send = vi.fn();
  const frame = { url: "hush://app/index.html" };
  const window = { isDestroyed: () => false, isFocused: () => true, on() {}, webContents: { send, mainFrame: frame } };
  const app = { getVersion: () => "0.5.0", getPath: () => "profile", isPackaged: true, enableSandbox() {}, requestSingleInstanceLock: () => true,
    whenReady: () => new Promise(() => {}), on() {}, quit() {}, setAppUserModelId: vi.fn() };
  const updater = Object.assign(new EventEmitter(), {
    checkForUpdates: vi.fn().mockResolvedValue(null), setFeedURL: vi.fn(), quitAndInstall: vi.fn(),
  });
  const rustInstall = vi.fn((canInstall: () => boolean) => {
    if (!canInstall()) throw new Error("Finish the call first");
  });
  const createRustUpgrade = vi.fn(({ updateStatus }: { updateStatus: (state: string, details: object) => void }) => ({
    check: async () => updateStatus("downloaded", { target: "rust", version: "0.5.0" }),
    install: rustInstall,
  }));
  const dependencies: Record<string, unknown> = {
    "electron-updater": { autoUpdater: updater },
    "node:path": { join: (...parts: string[]) => parts.join("/") },
    "node:fs": { existsSync: () => migrated },
    "./attachment-downloads.cjs": { registerAttachmentDownloads() {} },
    "./device-migration.cjs": { migrationArguments: () => null, registerDeviceMigration: () => ({ hasPendingMigration: () => false, abort() {} }) },
    "./rust-upgrade.cjs": { createRustUpgrade },
    "./window-material.cjs": { setWindowMaterial },
  };
  const electron = { app, clipboard, nativeTheme, BrowserWindow: { fromWebContents: (contents: unknown) => contents === window.webContents ? window : null },
    ipcMain: { on() {}, handle: (channel: string, handler: (...args: any[]) => any) => handlers.set(channel, handler) },
    protocol: { registerSchemesAsPrivileged() {} }, dialog: { showMessageBox: vi.fn().mockResolvedValue({ response: 1 }) },
    Notification: class { constructor() {} show() {} on() {} static isSupported() { return true; } },
  };
  const context: Record<string, any> = {
    require: (name: string) => name === "electron" ? electron : dependencies[name] ?? {},
    process: { env: {}, platform: "win32", arch: rust ? "x64" : "arm64" }, setInterval: () => ({ unref() {} }), setImmediate: (fn: () => void) => fn(),
    URL, Response, console,
  };
  const source = readFileSync(new URL("../../electron/main.cjs", import.meta.url), "utf8");
  runInNewContext(source + "\nglobalThis.testApi = { configureAutoUpdater, checkForUpdates, setWindow: w => { mainWindow = w; } };", context);
  context.testApi.setWindow(window);
  const event = { sender: window.webContents, senderFrame: frame };
  return { handlers, clipboard, updater, event, api: context.testApi, send, nativeTheme, setWindowMaterial, window, createRustUpgrade, rustInstall };
}

describe("desktop clipboard and updates", () => {
  it("uses dark native surfaces and restricts material changes to the trusted main frame", () => {
    const { handlers, event, nativeTheme, setWindowMaterial, window } = desktopHarness();
    expect(nativeTheme.themeSource).toBe("dark");
    const material = handlers.get("window:set-material")!;
    expect(material(event, true)).toBe(true);
    expect(setWindowMaterial).toHaveBeenLastCalledWith(window, true);
    expect(material(event, false)).toBe(false);
    expect(setWindowMaterial).toHaveBeenLastCalledWith(window, false);
    setWindowMaterial.mockClear();
    expect(material({ ...event, senderFrame: { url: "https://example.com" } }, true)).toBe(false);
    expect(material({ ...event, sender: {} }, true)).toBe(false);
    expect(material(event, "acrylic")).toBe(false);
    expect(setWindowMaterial).not.toHaveBeenCalled();
  });
  it("allows clipboard writes only from the trusted main frame", () => {
    const { handlers, clipboard, event } = desktopHarness();
    const write = handlers.get("clipboard:write")!;
    write(event, "hush://invite/abc");
    expect(clipboard.writeText).toHaveBeenCalledWith("hush://invite/abc");
    expect(() => write({ ...event, senderFrame: { url: "https://example.com" } }, "secret")).toThrow();
    expect(() => write(event, "x".repeat(16385))).toThrow();
  });
  it("uses the requested GitHub release feed and enables background downloads", async () => {
    const { api, updater } = desktopHarness();
    api.configureAutoUpdater();
    expect(updater.setFeedURL).toHaveBeenCalledWith({ provider: "github", owner: "DexiAkaStompa", repo: "hush" });
    expect((updater as any).autoDownload).toBe(true);
    expect((updater as any).autoInstallOnAppQuit).toBe(true);
    await api.checkForUpdates();
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1);
  });
  it("reports download progress, preserves the target version, and guards installation", async () => {
    const { api, handlers, event, updater } = desktopHarness();
    api.configureAutoUpdater();
    expect(() => handlers.get("updates:install")!(event)).toThrow();
    updater.emit("update-available", { version: "0.6.0" });
    updater.emit("download-progress", { percent: 42 });
    expect(handlers.get("updates:get-status")!(event)).toMatchObject({ status: "downloading", version: "0.6.0", percent: 42 });
    updater.emit("update-downloaded", { version: "0.6.0" });
    await api.checkForUpdates();
    expect(handlers.get("updates:get-status")!(event).status).toBe("downloaded");
    handlers.get("updates:install")!(event);
    expect(updater.quitAndInstall).toHaveBeenCalledTimes(1);
  });
  it("surfaces errors without blocking the client and permits retry", async () => {
    const { api, updater, handlers, event } = desktopHarness();
    api.configureAutoUpdater();
    await api.checkForUpdates();
    updater.emit("error", new Error("Offline"));
    expect(handlers.get("updates:get-status")!(event).status).toBe("error");
    await handlers.get("updates:check")!(event);
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(2);
  });
  it("downloads Rust in the background and allows the handoff only in a signed-in, idle workspace", async () => {
    const { api, handlers, event, updater, rustInstall } = desktopHarness({ rust: true });
    api.configureAutoUpdater();
    await api.checkForUpdates();
    expect(updater.checkForUpdates).not.toHaveBeenCalled();
    expect(handlers.get("updates:get-status")!(event)).toMatchObject({ status: "downloaded", target: "rust" });
    const install = handlers.get("updates:install")!;
    const presence = handlers.get("updates:set-call-active")!;
    expect(() => install(event)).toThrow();
    presence(event, true, true);
    expect(() => install(event)).toThrow();
    presence(event, false, true);
    expect(() => install(event)).not.toThrow();
    expect(rustInstall).toHaveBeenCalledTimes(3);
    presence(event, false, false);
    expect(() => install(event)).toThrow();
  });
  it("keeps the legacy feed available when reopening Electron after migration", () => {
    const { api, updater, createRustUpgrade } = desktopHarness({ rust: true, migrated: true });
    api.configureAutoUpdater();
    expect(createRustUpgrade).not.toHaveBeenCalled();
    expect(updater.setFeedURL).toHaveBeenCalledOnce();
  });
});
