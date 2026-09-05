import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";

function desktopHarness() {
  const handlers = new Map<string, (...args: any[]) => any>();
  const clipboard = { writeText: vi.fn() };
  const send = vi.fn();
  const frame = { url: "hush://app/index.html" };
  const window = { isDestroyed: () => false, webContents: { send, mainFrame: frame } };
  const app = { getVersion: () => "0.5.0", isPackaged: true, enableSandbox() {}, requestSingleInstanceLock: () => true,
    whenReady: () => new Promise(() => {}), on() {}, quit() {}, setAppUserModelId: vi.fn() };
  const updater = Object.assign(new EventEmitter(), {
    checkForUpdates: vi.fn().mockResolvedValue(null), setFeedURL: vi.fn(), quitAndInstall: vi.fn(),
  });
  const electron = { app, clipboard, BrowserWindow: { fromWebContents: (contents: unknown) => contents === window.webContents ? window : null },
    ipcMain: { on() {}, handle: (channel: string, handler: (...args: any[]) => any) => handlers.set(channel, handler) },
    protocol: { registerSchemesAsPrivileged() {} }, dialog: { showMessageBox: vi.fn().mockResolvedValue({ response: 1 }) },
    Notification: class { constructor() {} show() {} on() {} static isSupported() { return true; } },
  };
  const context: Record<string, any> = {
    require: (name: string) => name === "electron" ? electron : name === "electron-updater" ? { autoUpdater: updater } : {},
    process: { env: {}, platform: "win32" }, setInterval: () => ({ unref() {} }), setImmediate: (fn: () => void) => fn(),
    URL, Response, console,
  };
  const source = readFileSync(new URL("../../electron/main.cjs", import.meta.url), "utf8");
  runInNewContext(source + "\nglobalThis.testApi = { configureAutoUpdater, checkForUpdates, setWindow: w => { mainWindow = w; } };", context);
  context.testApi.setWindow(window);
  const event = { sender: window.webContents, senderFrame: frame };
  return { handlers, clipboard, updater, event, api: context.testApi, send };
}

describe("desktop clipboard and updates", () => {
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
});
