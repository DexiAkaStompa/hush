import { afterEach, beforeEach, expect, test, vi } from "vitest";

const auth = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock("./supabase", () => ({ supabase: { auth } }));

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("VITE_TURN_URL", "https://hush-turn-credentials.mattiapalermo317.workers.dev/credentials");
  auth.getSession.mockResolvedValue({ data: { session: { user: { id: "user" }, access_token: "caller-jwt" } }, error: null });
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

const credentials = () => ({ expiresAt: Date.now() + 3_600_000, iceServers: [{ urls: ["turns:turn.cloudflare.com:443?transport=tcp"], username: "temporary", credential: "temporary" }] });

test("Rust relay requests retain caller authentication and use the existing validation and memory cache", async () => {
  const requestCallRelay = vi.fn().mockResolvedValue(credentials());
  const network = vi.fn();
  vi.stubGlobal("window", { hushWindow: { requestCallRelay } });
  vi.stubGlobal("fetch", network);
  const { loadCallIceConfig } = await import("./call-ice");
  expect((await loadCallIceConfig("room")).relayAvailable).toBe(true);
  expect((await loadCallIceConfig("room")).relayAvailable).toBe(true);
  expect(requestCallRelay).toHaveBeenCalledExactlyOnceWith("caller-jwt", "room");
  expect(network).not.toHaveBeenCalled();
});

test("native responses cannot introduce arbitrary TURN hosts", async () => {
  vi.stubGlobal("window", { hushWindow: { requestCallRelay: vi.fn().mockResolvedValue({ ...credentials(), iceServers: [{ urls: "turn:evil.example:3478", username: "x", credential: "x" }] }) } });
  const { loadCallIceConfig } = await import("./call-ice");
  expect((await loadCallIceConfig("room")).relayAvailable).toBe(false);
});

test("a canceled call never consumes or caches native relay credentials", async () => {
  const controller = new AbortController();
  const requestCallRelay = vi.fn().mockImplementation(async () => { controller.abort(); return credentials(); });
  vi.stubGlobal("window", { hushWindow: { requestCallRelay } });
  const { loadCallIceConfig } = await import("./call-ice");
  await expect(loadCallIceConfig("room", controller.signal)).rejects.toThrow();
  expect((await loadCallIceConfig("room")).relayAvailable).toBe(true);
  expect(requestCallRelay).toHaveBeenCalledTimes(2);
});

test("Electron and web retain the authenticated HTTP path", async () => {
  vi.stubGlobal("window", { hushWindow: {} });
  const network = vi.fn().mockResolvedValue(Response.json(credentials()));
  vi.stubGlobal("fetch", network);
  const { loadCallIceConfig } = await import("./call-ice");
  expect((await loadCallIceConfig("room")).relayAvailable).toBe(true);
  expect(network.mock.calls[0][1].headers.Authorization).toBe("Bearer caller-jwt");
});
