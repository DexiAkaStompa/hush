import { describe, expect, it } from "vitest";
import { parseCallIceConfig } from "./call-ice";

describe("call ICE credentials", () => {
  const valid = () => ({ expiresAt: Date.now() + 3600000, iceServers: [{ urls: ["turn:turn.cloudflare.com:3478?transport=udp", "turns:turn.cloudflare.com:443?transport=tcp"], username: "temporary", credential: "password" }] });
  it("accepts temporary UDP and TLS relay credentials", () => { expect(parseCallIceConfig(valid()).relayAvailable).toBe(true); });
  it("rejects expired and unexpectedly long-lived credentials", () => {
    expect(() => parseCallIceConfig({ ...valid(), expiresAt: Date.now() })).toThrow();
    expect(() => parseCallIceConfig({ ...valid(), expiresAt: Date.now() + 86400000 })).toThrow();
  });
  it("rejects arbitrary relay hosts and absent credentials", () => {
    expect(() => parseCallIceConfig({ ...valid(), iceServers: [{ urls: "turn:evil.example:3478", username: "u", credential: "p" }] })).toThrow();
    expect(() => parseCallIceConfig({ ...valid(), iceServers: [{ urls: "turn:turn.cloudflare.com:3478" }] })).toThrow();
  });
});
