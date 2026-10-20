import { describe, expect, it, vi } from "vitest";
import { handleTurnRequest, safeIceServers } from "./worker";

const env: TurnEnv = { SUPABASE_URL: "https://project.supabase.co", SUPABASE_PUBLISHABLE_KEY: "public-key", TURN_KEY_ID: "key-id", TURN_KEY_API_TOKEN: "server-secret", ALLOWED_ORIGINS: "hush://app,https://localhost" };
const conversationId = "00000000-0000-4000-8000-000000000001";
const iceServers = [{ urls: ["turns:turn.cloudflare.com:443?transport=tcp"], username: "temporary-user", credential: "temporary-password" }];
const request = (overrides: RequestInit = {}) => new Request("https://relay.example/credentials", { method: "POST", headers: { Authorization: "Bearer user-jwt", Origin: "https://localhost", "Content-Type": "application/json" }, body: JSON.stringify({ conversationId }), ...overrides });
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
describe("TURN credential broker", () => {
  it("issues short-lived credentials only after authentication and room authorization", async () => {
    const network = vi.fn().mockResolvedValueOnce(json({ id: "user-id" })).mockResolvedValueOnce(json(true)).mockResolvedValueOnce(json({ iceServers }));
    const response = await handleTurnRequest(request(), env, network);
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.iceServers).toEqual(iceServers);
    expect(result.expiresAt).toBeGreaterThan(Date.now() + 3500000);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("access-control-allow-origin")).toBe("https://localhost");
    expect(network.mock.calls[1][1].body).toBe(JSON.stringify({ p_conversation_id: conversationId }));
    expect(network.mock.calls[2][1].headers.Authorization).toBe("Bearer server-secret");
    expect(network.mock.calls[2][1].body).toBe(JSON.stringify({ ttl: 3600, customIdentifier: "user-id" }));
    expect(JSON.stringify(result)).not.toContain("server-secret");
  });
  it.each([401, 403])("does not contact TURN when authentication or membership fails (%s)", async status => {
    const network = vi.fn();
    if (status === 401) network.mockResolvedValueOnce(json({}, 401));
    else network.mockResolvedValueOnce(json({ id: "user-id" })).mockResolvedValueOnce(json({}, 403));
    expect((await handleTurnRequest(request(), env, network)).status).toBe(status);
    expect(network).toHaveBeenCalledTimes(status === 401 ? 1 : 2);
  });
  it("limits requests before generating new credentials", async () => {
    const network = vi.fn().mockResolvedValueOnce(json({ id: "user-id" })).mockResolvedValueOnce(json(false));
    expect((await handleTurnRequest(request(), env, network)).status).toBe(429);
    expect(network).toHaveBeenCalledTimes(2);
  });
  it("rejects untrusted origins and oversized bodies before upstream calls", async () => {
    const network = vi.fn();
    expect((await handleTurnRequest(request({ headers: { Origin: "https://untrusted.example" } }), env, network)).status).toBe(403);
    expect((await handleTurnRequest(request({ body: "x".repeat(1025) }), env, network)).status).toBe(400);
    expect(network).not.toHaveBeenCalled();
  });
  it("supports the Android HTTPS origin preflight", async () => {
    const response = await handleTurnRequest(new Request("https://relay.example/credentials", { method: "OPTIONS", headers: { Origin: "https://localhost" } }), env);
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe("https://localhost");
  });
  it("does not return provider errors or permanent secrets", async () => {
    const network = vi.fn().mockRejectedValue(new Error("server-secret"));
    const response = await handleTurnRequest(request(), env, network);
    expect(response.status).toBe(503);
    expect(await response.text()).toBe('{"error":"relay_unavailable"}');
  });
  it("rejects unexpected TURN hosts, ports and missing credentials", () => {
    expect(() => safeIceServers({ iceServers: [{ urls: "turn:evil.example:3478", username: "u", credential: "p" }] })).toThrow();
    expect(() => safeIceServers({ iceServers: [{ urls: "turn:turn.cloudflare.com:53", username: "u", credential: "p" }] })).toThrow();
    expect(() => safeIceServers({ iceServers: [{ urls: "turn:turn.cloudflare.com:3478" }] })).toThrow();
    expect(safeIceServers({ iceServers })).toEqual(iceServers);
  });
});
