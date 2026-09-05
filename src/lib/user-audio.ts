import { useSyncExternalStore } from "react";

export type UserAudioPrefs = {
  volume: number; // 0 to 200, default 100
  muted: boolean; // default false
  videoDisabled: boolean; // default false
};

const STORAGE_KEY = "hush_user_audio_prefs";
const DEFAULT_PREFS: UserAudioPrefs = {
  volume: 100,
  muted: false,
  videoDisabled: false,
};

let cache: Record<string, UserAudioPrefs> | null = null;
const listeners = new Set<() => void>();

function loadFromStorage(): Record<string, UserAudioPrefs> {
  if (cache) return cache;
  try {
    const raw = typeof window !== "undefined" ? window.localStorage?.getItem(STORAGE_KEY) : null;
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        cache = parsed;
        return cache!;
      }
    }
  } catch {
    // Ignore storage parse error
  }
  cache = {};
  return cache;
}

function saveToStorage() {
  try {
    if (typeof window !== "undefined" && cache) {
      window.localStorage?.setItem(STORAGE_KEY, JSON.stringify(cache));
    }
  } catch {
    // Ignore storage write error
  }
  listeners.forEach((listener) => listener());
}

export function getUserAudioPrefs(userId: string): UserAudioPrefs {
  if (!userId) return { ...DEFAULT_PREFS };
  const store = loadFromStorage();
  const current = store[userId];
  if (!current) {
    return { ...DEFAULT_PREFS };
  }
  return {
    volume: typeof current.volume === "number" ? Math.max(0, Math.min(200, current.volume)) : 100,
    muted: Boolean(current.muted),
    videoDisabled: Boolean(current.videoDisabled),
  };
}

export function setUserVolume(userId: string, volume: number) {
  if (!userId) return;
  const store = loadFromStorage();
  const clamped = Math.max(0, Math.min(200, Math.round(volume)));
  const current = getUserAudioPrefs(userId);
  store[userId] = { ...current, volume: clamped };
  saveToStorage();
}

export function setUserMuted(userId: string, muted: boolean) {
  if (!userId) return;
  const store = loadFromStorage();
  const current = getUserAudioPrefs(userId);
  store[userId] = { ...current, muted: Boolean(muted) };
  saveToStorage();
}

export function setUserVideoDisabled(userId: string, disabled: boolean) {
  if (!userId) return;
  const store = loadFromStorage();
  const current = getUserAudioPrefs(userId);
  store[userId] = { ...current, videoDisabled: Boolean(disabled) };
  saveToStorage();
}

export function resetUserAudioPrefs(userId: string) {
  if (!userId) return;
  const store = loadFromStorage();
  delete store[userId];
  saveToStorage();
}

export function subscribeUserAudio(callback: () => void): () => void {
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
}

export function useUserAudioPrefs(userId: string): UserAudioPrefs {
  return useSyncExternalStore(
    subscribeUserAudio,
    () => getUserAudioPrefs(userId),
    () => DEFAULT_PREFS
  );
}
