import { describe, expect, it } from "vitest";
import { extractMusicBroadcast, formatMusicTime, isDirectMusicUrl, musicTopic, synchronizedMusicPosition } from "./music";

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
});
