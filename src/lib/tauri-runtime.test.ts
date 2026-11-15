import { afterEach, beforeEach, expect, test, vi } from "vitest";

const native = vi.hoisted(() => ({
  isTauri: vi.fn(), invoke: vi.fn(), listen: vi.fn(), unlisteners: [] as Array<ReturnType<typeof vi.fn>>,
  callbacks: new Map<string, (event: { payload: unknown }) => void>(),
  resize: undefined as (() => void) | undefined,
  window: {
    minimize: vi.fn(), toggleMaximize: vi.fn(), close: vi.fn(),
    isMaximized: vi.fn(), startDragging: vi.fn(), onResized: vi.fn(),
  },
}));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: native.isTauri, invoke: native.invoke }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => native.window }));
vi.mock("@tauri-apps/api/event", () => ({ listen: native.listen }));

import { initTauriRuntime, isWindowDragTarget, validTauriLink } from "./tauri-runtime";

class TestElement extends EventTarget {
  constructor(readonly tagName: string, readonly className = "", readonly parent: TestElement | null = null) { super(); }
  closest(selector: string): TestElement | null {
    const selectors = selector.split(", ");
    for (let candidate: TestElement | null = this; candidate; candidate = candidate.parent) {
      if (selectors.some(value => value.startsWith(".") ? candidate!.className.split(" ").includes(value.slice(1)) : candidate!.tagName === value)) return candidate;
    }
    return null;
  }
}
class TestAnchor extends TestElement {
  readonly download = "recording.wav";
  readonly href = "blob:https://tauri.localhost/file";
  constructor() { super("a"); }
  hasAttribute(value: string) { return value === "download"; }
}

let dispose: (() => void) | null = null;
let documentTarget: EventTarget;
let storage: Map<string, string>;

beforeEach(() => {
  vi.clearAllMocks();
  native.callbacks.clear();
  native.unlisteners.length = 0;
  native.isTauri.mockReturnValue(true);
  native.invoke.mockImplementation(async (command: string) => command === "native_version" ? "0.5.65" : command === "attachment_save_begin" ? "save-token" : command === "native_updates_check" || command === "native_updates_get_status" ? { status: "idle", currentVersion: "0.5.65" } : null);
  native.window.minimize.mockResolvedValue(undefined);
  native.window.toggleMaximize.mockResolvedValue(undefined);
  native.window.close.mockResolvedValue(undefined);
  native.window.startDragging.mockResolvedValue(undefined);
  native.window.isMaximized.mockResolvedValue(false);
  native.window.onResized.mockImplementation(async (callback: () => void) => {
    native.resize = callback;
    const unlisten = vi.fn(); native.unlisteners.push(unlisten); return unlisten;
  });
  native.listen.mockImplementation(async (name: string, callback: (event: { payload: unknown }) => void) => {
    native.callbacks.set(name, callback);
    const unlisten = vi.fn(); native.unlisteners.push(unlisten); return unlisten;
  });
  documentTarget = new EventTarget();
  storage = new Map();
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("document", documentTarget);
  vi.stubGlobal("Element", TestElement);
  vi.stubGlobal("sessionStorage", { setItem: (key: string, value: string) => storage.set(key, value) });
});
afterEach(() => {
  dispose?.(); dispose = null;
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function dispatchMouse(type: string, target: TestElement, details = {}) {
  const event = new Event(type, { cancelable: true });
  Object.defineProperty(event, "target", { value: target });
  Object.assign(event, { button: 0, detail: 1, ...details });
  documentTarget.dispatchEvent(event);
  return event;
}

test("browser startup and an existing Electron bridge are left intact", async () => {
  native.isTauri.mockReturnValue(false);
  expect(await initTauriRuntime()).toBeNull();
  expect(window.hushWindow).toBeUndefined();
  expect(native.invoke).not.toHaveBeenCalled();
  const electron = { close: vi.fn() } as unknown as HushWindowControls;
  window.hushWindow = electron;
  native.isTauri.mockReturnValue(true);
  expect(await initTauriRuntime()).toBeNull();
  expect(window.hushWindow).toBe(electron);
  expect(native.listen).not.toHaveBeenCalled();
});

test("the desktop contract sends raw attachment bytes and never forwards UI events to native controls", async () => {
  dispose = await initTauriRuntime();
  const api = window.hushWindow!;
  api.minimize(); api.toggleMaximize(); api.close();
  expect(native.window.minimize).toHaveBeenCalledExactlyOnceWith();
  expect(native.window.toggleMaximize).toHaveBeenCalledExactlyOnceWith();
  expect(native.window.close).toHaveBeenCalledExactlyOnceWith();
  const bytes = new Uint8Array([0, 255, 42]);
  await api.writeAttachmentSave!("save-token", 7, bytes);
  expect(native.invoke).toHaveBeenCalledWith("attachment_save_write", bytes, {
    headers: { "x-hush-token": "save-token", "x-hush-index": "7" },
  });
  await api.copyText("copied");
  expect(native.invoke).toHaveBeenCalledWith("native_copy_text", { text: "copied" });
  const conversationId = "11111111-2222-4333-8444-555555555555";
  const credentials = { iceServers: [{ urls: ["turn:turn.cloudflare.com:3478"] }] };
  native.invoke.mockResolvedValueOnce(credentials);
  expect(await api.requestCallRelay!("session-token", conversationId)).toBe(credentials);
  expect(native.invoke).toHaveBeenCalledWith("native_call_relay", { accessToken: "session-token", conversationId });
  expect(await api.checkForUpdates()).toMatchObject({ status: "idle", currentVersion: "0.5.65" });
  expect(native.invoke).toHaveBeenCalledWith("native_updates_check");
  await api.installUpdate();
  expect(native.invoke).toHaveBeenCalledWith("native_updates_install");
});

test("dragging preserves text and controls in interactive regions and supports header double-click", async () => {
  dispose = await initTauriRuntime();
  const header = new TestElement("header", "chat-header");
  const title = new TestElement("h2", "", header);
  const button = new TestElement("button", "", header);
  const icon = new TestElement("svg", "", button);
  const shell = new TestElement("div", "app-shell");
  const messages = new TestElement("div", "messages", shell);
  expect(isWindowDragTarget(title)).toBe(true);
  expect(isWindowDragTarget(icon)).toBe(false);
  expect(isWindowDragTarget(messages)).toBe(false);
  expect(dispatchMouse("mousedown", icon).defaultPrevented).toBe(false);
  expect(dispatchMouse("mousedown", title, { button: 2 }).defaultPrevented).toBe(false);
  expect(native.window.startDragging).not.toHaveBeenCalled();
  expect(dispatchMouse("mousedown", title).defaultPrevented).toBe(true);
  expect(native.window.startDragging).toHaveBeenCalledTimes(1);
  dispatchMouse("mousedown", title, { detail: 2 });
  expect(native.window.toggleMaximize).toHaveBeenCalledTimes(1);
});

test("launch links and later deep links use the existing UI event and reject arbitrary schemes", async () => {
  const channel = "hush://channel/11111111-2222-4333-8444-555555555555";
  native.invoke.mockImplementation(async (command: string) => command === "native_pending_link" ? channel : "0.5.65");
  const onLink = vi.fn(); documentTarget.addEventListener("hush:link", onLink);
  dispose = await initTauriRuntime();
  expect(storage.get("hush:pending-link")).toBe(channel);
  expect(onLink).toHaveBeenCalledTimes(1);
  const invite = `hush://invite/${"a".repeat(48)}/`;
  native.callbacks.get("hush:deep-link")!({ payload: invite });
  expect(storage.get("hush:pending-link")).toBe(invite.slice(0, -1));
  native.callbacks.get("hush:deep-link")!({ payload: "file:///secret" });
  expect(onLink).toHaveBeenCalledTimes(2);
  expect(validTauriLink("hush://invite/short")).toBe(false);
  expect(validTauriLink(`${channel}?redirect=https://example.com`)).toBe(false);
  expect(validTauriLink(null)).toBe(false);
});

test("a live deep link received during setup wins over an older launch link", async () => {
  const oldLink = `hush://invite/${"a".repeat(48)}`;
  const liveLink = `hush://invite/${"b".repeat(48)}`;
  let releasePending!: (value: string) => void;
  const pending = new Promise<string>(resolve => { releasePending = resolve; });
  native.invoke.mockImplementation(async (command: string) => command === "native_pending_link" ? pending : "0.5.65");
  const ready = initTauriRuntime();
  await vi.waitFor(() => expect(native.invoke).toHaveBeenCalledWith("native_pending_link"));
  native.callbacks.get("hush:deep-link")!({ payload: liveLink });
  releasePending(oldLink);
  dispose = await ready;
  expect(storage.get("hush:pending-link")).toBe(liveLink);
});

test("resizing coalesces native queries and all subscriptions are released on shutdown", async () => {
  vi.useFakeTimers();
  dispose = await initTauriRuntime();
  const callback = vi.fn();
  const unsubscribe = window.hushWindow!.onMaximizedChange(callback);
  native.window.isMaximized.mockResolvedValue(true);
  for (let i = 0; i < 8; i++) native.resize!();
  await vi.advanceTimersByTimeAsync(32);
  expect(native.window.isMaximized).toHaveBeenCalledTimes(1);
  expect(callback).toHaveBeenCalledExactlyOnceWith(true);
  unsubscribe();
  native.window.isMaximized.mockResolvedValue(false);
  native.resize!(); await vi.advanceTimersByTimeAsync(32);
  expect(callback).toHaveBeenCalledTimes(1);
  dispose!();
  expect(window.hushWindow).toBeUndefined();
  expect(native.unlisteners).toHaveLength(5);
  for (const unlisten of native.unlisteners) expect(unlisten).toHaveBeenCalledTimes(1);
  dispatchMouse("mousedown", new TestElement("header", "chat-header"));
  expect(native.window.startDragging).not.toHaveBeenCalled();
});

test("ordinary blob downloads use native ordered writes and abort an incomplete file on failure", async () => {
  dispose = await initTauriRuntime();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(new Uint8Array([1, 2, 3, 4]))));
  expect(dispatchMouse("click", new TestAnchor()).defaultPrevented).toBe(true);
  await vi.waitFor(() => expect(native.invoke).toHaveBeenCalledWith("attachment_save_finish", { token: "save-token" }));
  expect(native.invoke).toHaveBeenCalledWith("attachment_save_write", new Uint8Array([1, 2, 3, 4]), {
    headers: { "x-hush-token": "save-token", "x-hush-index": "0" },
  });
  native.invoke.mockClear();
  native.invoke.mockImplementation(async (command: string) => {
    if (command === "attachment_save_begin") return "failed-token";
    if (command === "attachment_save_write") throw new Error("Disk full");
    return undefined;
  });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(new Uint8Array([9]))));
  const onError = vi.fn(); documentTarget.addEventListener("hush:native-error", onError);
  dispatchMouse("click", new TestAnchor());
  await vi.waitFor(() => expect(native.invoke).toHaveBeenCalledWith("attachment_save_abort", { token: "failed-token" }));
  expect(native.invoke).not.toHaveBeenCalledWith("attachment_save_finish", expect.anything());
  expect(onError).toHaveBeenCalledTimes(1);
});

test("a large blob is sent in bounded binary blocks and a canceled save never writes", async () => {
  dispose = await initTauriRuntime();
  const data = new Uint8Array(8 * 1024 * 1024 + 3).fill(7);
  data[data.length - 1] = 255;
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(data)));
  dispatchMouse("click", new TestAnchor());
  await vi.waitFor(() => expect(native.invoke).toHaveBeenCalledWith("attachment_save_finish", { token: "save-token" }));
  const writes = native.invoke.mock.calls.filter(([command]) => command === "attachment_save_write");
  expect(writes).toHaveLength(2);
  expect(writes.map(([, bytes]) => bytes.byteLength)).toEqual([8 * 1024 * 1024, 3]);
  expect(writes[1][1]).toEqual(new Uint8Array([7, 7, 255]));
  expect(writes[1][2]).toEqual({ headers: { "x-hush-token": "save-token", "x-hush-index": "1" } });
  native.invoke.mockClear();
  native.invoke.mockResolvedValue(null);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(new Uint8Array([1]))));
  dispatchMouse("click", new TestAnchor());
  await vi.waitFor(() => expect(native.invoke).toHaveBeenCalledWith("attachment_save_begin", { name: "recording.wav" }));
  expect(native.invoke.mock.calls.map(([command]) => command)).toEqual(["attachment_save_begin"]);
});

test("failed setup releases partially registered native listeners without publishing a broken bridge", async () => {
  native.listen.mockRejectedValueOnce(new Error("Native listener unavailable"));
  await expect(initTauriRuntime()).rejects.toThrow("Native listener unavailable");
  expect(window.hushWindow).toBeUndefined();
  expect(native.unlisteners).toHaveLength(1);
  expect(native.unlisteners[0]).toHaveBeenCalledTimes(1);
});
