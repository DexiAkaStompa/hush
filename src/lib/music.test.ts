import { describe, expect, it } from "vitest";
import {
  calibrateServerClock,
  extractMusicBroadcast,
  formatMusicTime,
  isDirectMusicUrl,
  musicTopic,
  providerEmbedUrl,
  setServerClockSkew,
  synchronizedMusicPosition,
} from "./music";

const state = {
  conversation_id: "room-1",
  source_url: "https://media.example/track.mp3",
  title: "Track",
  is_playing: true,
  position_seconds: 10,
  anchor_at: "2026-08-21T12:00:00.000Z",
  revision: 2,
  updated_by: "user-1",
  updated_at: "2026-08-21T12:00:00.000Z",
};

describe("client music synchronization", () => {
  it("accepts only HTTPS sources", () => {
    expect(isDirectMusicUrl("https://media.example/track.mp3")).toBe(true);
    expect(isDirectMusicUrl("http://media.example/track.mp3")).toBe(false);
    expect(isDirectMusicUrl("https://127.0.0.1/private.mp3")).toBe(false);
    expect(isDirectMusicUrl("https://user:secret@media.example/track.mp3")).toBe(false);
    expect(isDirectMusicUrl("not-a-url")).toBe(false);
  });

  it("derives the shared playhead from the server anchor", () => {
    expect(synchronizedMusicPosition(state, Date.parse(state.anchor_at) + 2500)).toBe(12.5);
  });

  it("extracts database broadcasts and formats time", () => {
    expect(extractMusicBroadcast({ payload: { new: state } })?.revision).toBe(2);
    expect(formatMusicTime(125.9)).toBe("2:05");
    expect(musicTopic("room-1")).toBe("music:room-1");
  });

  it("calibrates clock skew and prevents 8s jump on newly started tracks", () => {
    // Simulate user PC being 8000ms ahead of server
    const serverTimestamp = "2026-08-21T12:00:00.000Z";
    const serverTimeMs = Date.parse(serverTimestamp);
    const clientTimeMs = serverTimeMs + 8000;

    // Calibrate: client received response at clientTimeMs with 100ms round trip
    calibrateServerClock(serverTimestamp, clientTimeMs - 100, clientTimeMs);

    const freshTrack = {
      ...state,
      position_seconds: 0,
      anchor_at: serverTimestamp,
    };

    // With clock skew calibrated, effectiveNow is aligned to serverTimeMs, not clientTimeMs + 8s
    const position = synchronizedMusicPosition(freshTrack, clientTimeMs);
    expect(position).toBe(0);

    // Reset skew for other tests
    setServerClockSkew(0);
  });

  it("omits start query parameter on YouTube embeds when position is near beginning", () => {
    const freshEmbed = providerEmbedUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ", "youtube", 0.5, true);
    expect(freshEmbed).not.toContain("start=");

    const midEmbed = providerEmbedUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ", "youtube", 45.2, true);
    expect(midEmbed).toContain("start=45");
  });

  it("uses desktop window.hushWindow.searchMusic when available", async () => {
    const { searchMusicBridge } = await import("./musicBridge");
    const mockTrack = {
      title: "Test Track",
      author: "Artist",
      url: "https://www.youtube.com/watch?v=123",
      artworkUrl: null,
      length: 180000,
    };
    const originalWindow = globalThis.window;
    globalThis.window = {
      hushWindow: {
        searchMusic: async () => [mockTrack],
      },
    } as unknown as Window & typeof globalThis;

    const results = await searchMusicBridge("test query", "youtube");
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe("Test Track");

    globalThis.window = originalWindow;
  });
});
