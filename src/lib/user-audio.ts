import { useSyncExternalStore } from "react";

export type UserAudioPrefs = {
  readonly volume: number; // 0 to 200, default 100
  readonly muted: boolean; // default false
  readonly videoDisabled: boolean; // default false
};

const STORAGE_KEY = "hush_user_audio_prefs";

export const DEFAULT_USER_AUDIO_PREFS: Readonly<UserAudioPrefs> = Object.freeze({
  volume: 100,
  muted: false,
  videoDisabled: false,
});

let cache: Record<string, Readonly<UserAudioPrefs>> | null = null;
const listeners = new Set<() => void>();

function normalizeUserAudioPrefs(data: unknown): Readonly<UserAudioPrefs> {
  if (!data || typeof data !== "object") return DEFAULT_USER_AUDIO_PREFS;
  const obj = data as Partial<UserAudioPrefs>;
  const volume =
    typeof obj.volume === "number" && Number.isFinite(obj.volume)
      ? Math.max(0, Math.min(200, Math.round(obj.volume)))
      : 100;
  const muted = Boolean(obj.muted);
  const videoDisabled = Boolean(obj.videoDisabled);

  if (volume === 100 && !muted && !videoDisabled) {
    return DEFAULT_USER_AUDIO_PREFS;
  }

  return Object.freeze({
    volume,
    muted,
    videoDisabled,
  });
}

function loadFromStorage(): Record<string, Readonly<UserAudioPrefs>> {
  if (cache) return cache;
  const loaded: Record<string, Readonly<UserAudioPrefs>> = {};
  try {
    const raw = typeof window !== "undefined" ? window.localStorage?.getItem(STORAGE_KEY) : null;
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        for (const [id, value] of Object.entries(parsed)) {
          loaded[id] = normalizeUserAudioPrefs(value);
        }
      }
    }
  } catch {
    // Ignore storage parse error
  }
  cache = loaded;
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

if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key !== STORAGE_KEY && event.key !== null) return;
    cache = null;
    loadFromStorage();
    listeners.forEach((listener) => listener());
  });
}

export function getUserAudioPrefs(userId: string): Readonly<UserAudioPrefs> {
  if (!userId) return DEFAULT_USER_AUDIO_PREFS;
  const store = loadFromStorage();
  return store[userId] ?? DEFAULT_USER_AUDIO_PREFS;
}

export function setUserVolume(userId: string, volume: number) {
  if (!userId) return;
  const store = loadFromStorage();
  const current = getUserAudioPrefs(userId);
  const clamped = Math.max(0, Math.min(200, Math.round(volume)));
  if (current.volume === clamped) return;

  store[userId] = Object.freeze({
    ...current,
    volume: clamped,
  });
  saveToStorage();
}

export function setUserMuted(userId: string, muted: boolean) {
  if (!userId) return;
  const store = loadFromStorage();
  const current = getUserAudioPrefs(userId);
  const isMuted = Boolean(muted);
  if (current.muted === isMuted) return;

  store[userId] = Object.freeze({
    ...current,
    muted: isMuted,
  });
  saveToStorage();
}

export function setUserVideoDisabled(userId: string, disabled: boolean) {
  if (!userId) return;
  const store = loadFromStorage();
  const current = getUserAudioPrefs(userId);
  const isVideoDisabled = Boolean(disabled);
  if (current.videoDisabled === isVideoDisabled) return;

  store[userId] = Object.freeze({
    ...current,
    videoDisabled: isVideoDisabled,
  });
  saveToStorage();
}

export function resetUserAudioPrefs(userId: string) {
  if (!userId) return;
  const store = loadFromStorage();
  if (!(userId in store)) return;
  delete store[userId];
  saveToStorage();
}

export function subscribeUserAudio(callback: () => void): () => void {
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
}

export function useUserAudioPrefs(userId: string): Readonly<UserAudioPrefs> {
  return useSyncExternalStore(
    subscribeUserAudio,
    () => getUserAudioPrefs(userId),
    () => DEFAULT_USER_AUDIO_PREFS
  );
}
