import { afterEach, expect, it, vi } from "vitest";
import {
  applyMigrationPreferences, collectMigrationPreferences, isMigrationPreferenceKey, remapMigrationMediaDevices,
  runMigrationSource, runMigrationTarget, readOriginalMigrationIdentity,
  productionMigrationSourceDependencies,
  bestEffortMigrationDevices,
  type MigrationSourceDependencies, type MigrationTargetDependencies, type MigrationPort, type MigrationStorage,
} from "./desktop-migration";
import { createMigrationReceiver, type MigrationWireMessage } from "./migration-transport";
import type { DeviceIdentity } from "./device-crypto";

afterEach(() => vi.unstubAllGlobals());
const USER = "11111111-2222-4333-8444-555555555555";
const SOURCE = "22222222-2222-4333-8444-555555555555";
const TARGET = "33333333-2222-4333-8444-555555555555";
const OTHER = "44444444-2222-4333-8444-555555555555";
const ROOMS = ["55555555-2222-4333-8444-555555555555", "66666666-2222-4333-8444-555555555555"];
function storage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  const result: MigrationStorage = { get length() { return values.size; }, key: index => [...values.keys()][index] ?? null,
    getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); }, removeItem: key => { values.delete(key); } };
  return { ...result, get length() { return values.size; }, values };
}
async function identity(id: string): Promise<DeviceIdentity> {
  const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
  return { id, userId: USER, privateKey: pair.privateKey, publicKey: await crypto.subtle.exportKey("jwk", pair.publicKey) };
}
function ports() {
  const messages: MigrationWireMessage[] = [], queued: MigrationWireMessage[][] = [[], []];
  const waiters: Array<Array<(value: MigrationWireMessage) => void>> = [[], []];
  const port = (index: number): MigrationPort => ({
    async send(value) {
      const message = structuredClone(value); messages.push(message);
      const receive = waiters[1 - index].shift();
      if (receive) receive(message); else queued[1 - index].push(message);
    },
    receive: () => queued[index].length ? Promise.resolve(queued[index].shift()!)
      : new Promise(resolve => waiters[index].push(resolve)),
  });
  return { source: port(0), target: port(1), messages };
}
async function fixture() {
  const original = await identity(SOURCE), destination = await identity(TARGET), shared = new Set<string>();
  const sourceStorage = storage({ "hush-theme": "frosted-glass", "hush:muted-chats": '["chat"]',
    [`hush:workspace:${USER}`]: '{"pinned":["chat"]}', "hush:media:v1": '{"inputId":"old-mic","inputVolume":76}',
    "sb-project-auth-token": "never-transfer-raw-storage-token", "GDRIVE_REFRESH_TOKEN": "never-transfer-drive-token" });
  const targetStorage = storage({ "unrelated-setting": "preserve" });
  const session = { access_token: "private-access-token-value", refresh_token: "private-refresh-token-value" };
  const sounds = [
    { id: "notification" as const, name: "message.wav", type: "audio/wav", data: new Blob([new Uint8Array(600_000).fill(17)]) },
    { id: "ringtone" as const, name: "call.mp3", type: "audio/mpeg", data: new Blob([new Uint8Array(450_000).fill(29)]) },
  ].map(sound => ({ ...sound, size: sound.data.size }));
  const source: MigrationSourceDependencies = {
    storage: sourceStorage, getSession: async () => ({ ...session, user: { id: USER } }), getUserId: async () => USER,
    readIdentity: async () => original, listConversationIds: async () => ROOMS,
    verifyTargetDevice: vi.fn(async (user, device) => user === USER && device === TARGET),
    shareKeyRing: vi.fn(async conversation => { shared.add(conversation); }),
    loadSounds: async () => sounds,
    enumerateDevices: async () => [{ deviceId: "old-mic", kind: "audioinput", label: "USB microphone" }],
    stopAutoRefresh: vi.fn(), resumeAutoRefresh: vi.fn(),
  };
  const savedSounds: { name: string; data: Blob }[] = [];
  const target: MigrationTargetDependencies = {
    storage: targetStorage, currentUserId: async () => null, getUserId: async () => USER,
    importSession: vi.fn(async () => USER), createIdentity: vi.fn(async () => destination),
    verifyKeyRing: vi.fn(async conversation => shared.has(conversation)),
    saveSound: vi.fn(async sound => { savedSounds.push(sound); }),
    enumerateDevices: async () => [{ deviceId: "new-mic", kind: "audioinput", label: "USB microphone" }],
  };
  return { original, destination, source, target, sourceStorage, targetStorage, savedSounds, sounds };
}
it("migrates an authenticated account, preferences, both chunked custom sounds and verified keyring handoff", async () => {
  const test = await fixture(), receiver = await createMigrationReceiver(), pipe = ports();
  const before = [...test.sourceStorage.values];
  const [source, target] = await Promise.all([
    runMigrationSource(receiver.hello, pipe.source, test.source),
    runMigrationTarget(receiver, pipe.target, test.target),
  ]);
  expect(source).toEqual({ userId: USER, deviceId: TARGET, conversations: 2 });
  expect(target.conversations).toBe(2);
  expect(test.targetStorage.getItem("hush-theme")).toBe("frosted-glass");
  expect(test.targetStorage.getItem("unrelated-setting")).toBe("preserve");
  expect(test.targetStorage.getItem("GDRIVE_REFRESH_TOKEN")).toBeNull();
  expect(test.targetStorage.getItem("sb-project-auth-token")).toBeNull();
  expect(JSON.parse(test.targetStorage.getItem("hush:media:v1")!)).toEqual({ inputId: "new-mic", inputVolume: 76 });
  expect([...test.sourceStorage.values]).toEqual(before);
  for (let index = 0; index < 2; index++) {
    expect(test.savedSounds[index].name).toBe(test.sounds[index].name);
    expect(new Uint8Array(await test.savedSounds[index].data.arrayBuffer())).toEqual(new Uint8Array(await test.sounds[index].data.arrayBuffer()));
  }
  expect(test.source.shareKeyRing).toHaveBeenCalledTimes(2);
  expect(test.target.verifyKeyRing).toHaveBeenCalledTimes(2);
  expect(test.source.resumeAutoRefresh).not.toHaveBeenCalled();
  const wire = JSON.stringify(pipe.messages);
  expect(wire).not.toContain("private-access-token");
  expect(wire).not.toContain("private-refresh-token");
  expect(wire).not.toContain("USB microphone");
  expect(test.original.privateKey.extractable).toBe(false);
  expect(test.destination.privateKey.extractable).toBe(false);
  expect(test.destination.id).not.toBe(test.original.id);
});
it("refuses another signed-in destination account before importing session, preferences, sounds or keys", async () => {
  const test = await fixture(), receiver = await createMigrationReceiver(), pipe = ports();
  test.target.currentUserId = async () => OTHER;
  const results = await Promise.allSettled([runMigrationSource(receiver.hello, pipe.source, test.source),
    runMigrationTarget(receiver, pipe.target, test.target)]);
  expect(results.every(result => result.status === "rejected")).toBe(true);
  expect(test.target.importSession).not.toHaveBeenCalled();
  expect(test.target.saveSound).not.toHaveBeenCalled();
  expect(test.source.shareKeyRing).not.toHaveBeenCalled();
  expect(test.targetStorage.getItem("hush-theme")).toBeNull();
  expect(test.source.resumeAutoRefresh).toHaveBeenCalledOnce();
});
it("requires server-verified receiver device ownership before sharing any old keyring", async () => {
  const test = await fixture(), receiver = await createMigrationReceiver(), pipe = ports();
  test.source.verifyTargetDevice = async () => false;
  const results = await Promise.allSettled([runMigrationSource(receiver.hello, pipe.source, test.source),
    runMigrationTarget(receiver, pipe.target, test.target)]);
  expect(results.every(result => result.status === "rejected")).toBe(true);
  expect(test.source.shareKeyRing).not.toHaveBeenCalled();
  expect(test.source.resumeAutoRefresh).toHaveBeenCalledOnce();
});
it("checkpoints the receiver's latest session into the retained original profile before verified shutdown", async () => {
  const test = await fixture(), receiver = await createMigrationReceiver(), pipe = ports();
  const early = { access_token: "checkpoint-access-token-early", refresh_token: "checkpoint-refresh-token-early" };
  const latest = { access_token: "checkpoint-access-token-latest", refresh_token: "checkpoint-refresh-token-latest" };
  test.target.currentSession = vi.fn().mockResolvedValueOnce(early).mockResolvedValueOnce(latest);
  test.target.stopAutoRefresh = vi.fn(); test.target.resumeAutoRefresh = vi.fn();
  test.source.updateOriginalSession = vi.fn(async () => USER);
  await Promise.all([runMigrationSource(receiver.hello, pipe.source, test.source),
    runMigrationTarget(receiver, pipe.target, test.target)]);
  expect(test.source.updateOriginalSession).toHaveBeenNthCalledWith(1, early);
  expect(test.source.updateOriginalSession).toHaveBeenNthCalledWith(2, latest);
  expect(test.source.stopAutoRefresh).toHaveBeenCalledTimes(3);
  expect(test.source.resumeAutoRefresh).not.toHaveBeenCalled();
  expect(test.target.stopAutoRefresh).toHaveBeenCalledOnce();
  expect(test.target.resumeAutoRefresh).toHaveBeenCalledOnce();
  expect(JSON.stringify(pipe.messages)).not.toContain("checkpoint-refresh-token");
});
it("refuses a session checkpoint from another account instead of replacing the original login", async () => {
  const test = await fixture(), receiver = await createMigrationReceiver(), pipe = ports();
  test.target.currentSession = async () => ({ access_token: "different-account-token", refresh_token: "different-account-refresh" });
  test.source.getUserId = async token => token === "different-account-token" ? OTHER : USER;
  test.source.updateOriginalSession = vi.fn(async () => USER);
  const results = await Promise.allSettled([runMigrationSource(receiver.hello, pipe.source, test.source),
    runMigrationTarget(receiver, pipe.target, test.target)]);
  expect(results.every(result => result.status === "rejected")).toBe(true);
  expect(test.source.updateOriginalSession).not.toHaveBeenCalled();
  expect(test.source.shareKeyRing).not.toHaveBeenCalled();
  expect(test.source.resumeAutoRefresh).toHaveBeenCalledOnce();
});
it("does not commit a migration whose destination cannot load an original conversation keyring", async () => {
  const test = await fixture(), receiver = await createMigrationReceiver(), pipe = ports();
  test.target.verifyKeyRing = async () => false;
  const results = await Promise.allSettled([runMigrationSource(receiver.hello, pipe.source, test.source),
    runMigrationTarget(receiver, pipe.target, test.target)]);
  expect(results.every(result => result.status === "rejected")).toBe(true);
  expect(test.source.resumeAutoRefresh).toHaveBeenCalledOnce();
  expect(test.original.id).toBe(SOURCE);
  expect(test.original.privateKey.extractable).toBe(false);
});
it("does not generate an original identity if the old profile has none", async () => {
  const test = await fixture(), receiver = await createMigrationReceiver(), pipe = ports();
  test.source.readIdentity = async () => null;
  const results = await Promise.allSettled([runMigrationSource(receiver.hello, pipe.source, test.source),
    runMigrationTarget(receiver, pipe.target, test.target)]);
  expect(results.every(result => result.status === "rejected")).toBe(true);
  expect(test.source.shareKeyRing).not.toHaveBeenCalled();
  expect(test.target.importSession).not.toHaveBeenCalled();
});
it("records the expected retry account before importing its session and stops if that binding cannot be saved", async () => {
  const test = await fixture(), receiver = await createMigrationReceiver(), pipe = ports();
  test.target.recordExpectedUser = vi.fn(() => { throw new Error("storage blocked"); });
  const results = await Promise.allSettled([runMigrationSource(receiver.hello, pipe.source, test.source),
    runMigrationTarget(receiver, pipe.target, test.target)]);
  expect(results.every(result => result.status === "rejected")).toBe(true);
  expect(test.target.recordExpectedUser).toHaveBeenCalledWith(USER);
  expect(test.target.importSession).not.toHaveBeenCalled();
  expect(test.source.resumeAutoRefresh).toHaveBeenCalledOnce();
});
it("treats valid legacy refresh tokens as opaque values rather than imposing a made-up minimum length", async () => {
  const test = await fixture(), receiver = await createMigrationReceiver(), pipe = ports();
  const opaque = { access_token: "valid-server-access-token", refresh_token: "0123456789ab", user: { id: USER } };
  test.source.getSession = async () => opaque;
  await Promise.all([runMigrationSource(receiver.hello, pipe.source, test.source),
    runMigrationTarget(receiver, pipe.target, test.target)]);
  expect(test.target.importSession).toHaveBeenCalledWith({ access_token: opaque.access_token, refresh_token: opaque.refresh_token });
});
it("exports only actual Hush preference keys and excludes account tokens, Drive secrets and guessed key stores", () => {
  const source = storage({ "hush-theme": "nord", [`hush:workspace:${USER}`]: "workspace",
    "hush:recent_emojis": "[]", "hush:room-music-volume:v1": "0.5", "hush_user_audio_prefs": "{}",
    "GDRIVE_CLIENT_SECRET": "secret", "hush:identity": "private", "hush:workspace:not-a-user": "invalid",
    "sb-project-auth-token": "session", "unrelated": "data" });
  expect(Object.keys(collectMigrationPreferences(source))).toHaveLength(5);
  for (const key of ["GDRIVE_CLIENT_SECRET", "hush:identity", "hush:workspace:not-a-user", "__proto__"]) {
    expect(isMigrationPreferenceKey(key)).toBe(false);
  }
  expect(() => applyMigrationPreferences(storage(), { "sb-project-auth-token": "secret" })).toThrow();
});
it("rolls back preference changes when the destination storage quota rejects a write", () => {
  const destination = storage({ "hush-theme": "midnight" });
  let writes = 0;
  const bounded: MigrationStorage = { ...destination, setItem(key, value) {
    if (++writes === 2) throw new Error("quota exceeded"); destination.setItem(key, value);
  } };
  expect(() => applyMigrationPreferences(bounded, { "hush-theme": "nord", "hush:user-status": "dnd" })).toThrow("quota");
  expect(destination.getItem("hush-theme")).toBe("midnight");
  expect(destination.getItem("hush:user-status")).toBeNull();
});
it("resolves origin-scoped audio IDs by device label and avoids unusable exact IDs", () => {
  const result = remapMigrationMediaDevices({ "hush:media:v1": JSON.stringify({ inputId: "old", outputId: "missing", cameraId: "same", noise: "rnnoise" }) },
    [{ kind: "audioinput", deviceId: "old", label: "USB mic" }],
    [{ kind: "audioinput", deviceId: "new", label: "USB mic" }, { kind: "videoinput", deviceId: "same", label: "Camera" }]);
  expect(JSON.parse(result["hush:media:v1"])).toEqual({ inputId: "new", outputId: "", cameraId: "same", noise: "rnnoise" });
});
it("never enumerates devices for a hidden document and bounds an unresolved visible enumeration to 750ms", async () => {
  const enumerate = vi.fn(() => new Promise<never>(() => {}));
  expect(await bestEffortMigrationDevices(enumerate, "hidden")).toEqual([]);
  expect(enumerate).not.toHaveBeenCalled();
  vi.useFakeTimers();
  try {
    const pending = bestEffortMigrationDevices(enumerate, "visible");
    await vi.advanceTimersByTimeAsync(750);
    expect(await pending).toEqual([]);
    expect(enumerate).toHaveBeenCalledOnce();
  } finally { vi.useRealTimers(); }
});
it("ignores permission failures and invalid optional device metadata without changing migration validity", async () => {
  expect(await bestEffortMigrationDevices(async () => { throw new Error("NotAllowedError"); }, "visible")).toEqual([]);
  expect(await bestEffortMigrationDevices(async () => [{ deviceId: "invalid", kind: "bad", label: "" }], "visible")).toEqual([]);
});
it("aborts opening a missing old identity database instead of creating a replacement", async () => {
  const abort = vi.fn(), request: any = { transaction: { abort } };
  vi.stubGlobal("indexedDB", { open: vi.fn(() => { queueMicrotask(() => { request.onupgradeneeded(); request.onerror(); }); return request; }) });
  expect(await readOriginalMigrationIdentity(USER)).toBeNull();
  expect(abort).toHaveBeenCalledOnce();
});
it("refreshes a nearly-expiring source session before handing it off, leaving healthy sessions unchanged", async () => {
  vi.stubGlobal("localStorage", storage());
  const fresh = { access_token: "fresh-access-token-value", refresh_token: "fresh-refresh-token-value", user: { id: USER }, expires_at: Date.now() / 1000 + 3600 };
  const near = { ...fresh, access_token: "nearly-expired-access-token", expires_at: Date.now() / 1000 + 30 };
  const getSession = vi.fn().mockResolvedValue({ data: { session: near }, error: null });
  const refreshSession = vi.fn().mockResolvedValue({ data: { session: fresh }, error: null });
  vi.doMock("./supabase", () => ({ supabase: { auth: { getSession, refreshSession } } }));
  try {
    const source = await productionMigrationSourceDependencies();
    expect(await source.getSession()).toBe(fresh);
    expect(refreshSession).toHaveBeenCalledOnce();
    getSession.mockResolvedValue({ data: { session: fresh }, error: null });
    expect(await source.getSession()).toBe(fresh);
    expect(refreshSession).toHaveBeenCalledOnce();
  } finally { vi.doUnmock("./supabase"); }
});
