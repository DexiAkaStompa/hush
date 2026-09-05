import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const storageMap = new Map<string, string>();
const localStorageMock = {
  getItem: (key: string) => storageMap.get(key) ?? null,
  setItem: (key: string, val: string) => { storageMap.set(key, val); },
  removeItem: (key: string) => { storageMap.delete(key); },
  clear: () => { storageMap.clear(); },
};

beforeAll(() => {
  // @ts-expect-error Mocking window in Node test runner
  globalThis.window = { localStorage: localStorageMock };
});

afterAll(() => {
  // @ts-expect-error Cleanup
  delete globalThis.window;
});

import {
  getUserAudioPrefs,
  resetUserAudioPrefs,
  setUserMuted,
  setUserVideoDisabled,
  setUserVolume,
  subscribeUserAudio,
} from "./user-audio";

describe("user-audio store", () => {
  const userId = "test-user-123";

  beforeEach(() => {
    resetUserAudioPrefs(userId);
    storageMap.clear();
  });

  it("returns default preferences for unknown user", () => {
    const prefs = getUserAudioPrefs(userId);
    expect(prefs).toEqual({
      volume: 100,
      muted: false,
      videoDisabled: false,
    });
  });

  it("sets and clamps volume between 0 and 200", () => {
    setUserVolume(userId, 75);
    expect(getUserAudioPrefs(userId).volume).toBe(75);

    setUserVolume(userId, 250);
    expect(getUserAudioPrefs(userId).volume).toBe(200);

    setUserVolume(userId, -10);
    expect(getUserAudioPrefs(userId).volume).toBe(0);

    setUserVolume(userId, 125.6);
    expect(getUserAudioPrefs(userId).volume).toBe(126);
  });

  it("toggles mute and videoDisabled independently", () => {
    setUserMuted(userId, true);
    expect(getUserAudioPrefs(userId).muted).toBe(true);
    expect(getUserAudioPrefs(userId).videoDisabled).toBe(false);

    setUserVideoDisabled(userId, true);
    expect(getUserAudioPrefs(userId).muted).toBe(true);
    expect(getUserAudioPrefs(userId).videoDisabled).toBe(true);

    setUserMuted(userId, false);
    expect(getUserAudioPrefs(userId).muted).toBe(false);
    expect(getUserAudioPrefs(userId).videoDisabled).toBe(true);
  });

  it("notifies subscribers when preferences change", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeUserAudio(listener);

    setUserVolume(userId, 120);
    expect(listener).toHaveBeenCalledTimes(1);

    setUserMuted(userId, true);
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    setUserVolume(userId, 100);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("resets user audio prefs", () => {
    setUserVolume(userId, 150);
    setUserMuted(userId, true);
    resetUserAudioPrefs(userId);

    expect(getUserAudioPrefs(userId)).toEqual({
      volume: 100,
      muted: false,
      videoDisabled: false,
    });
  });
});
