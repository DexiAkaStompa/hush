/**
 * Incoming call ringtone manager.
 * Supports custom audio files (MP3, WAV, OGG, M4A) stored in IndexedDB,
 * with graceful fallback to a Web Audio API synthesized harmonic chime loop.
 */

import { useSyncExternalStore } from "react";

export type CustomRingtoneRecord = {
  id: "active";
  name: string;
  size: number;
  type: string;
  data: Blob;
  updatedAt: number;
};

const DB_NAME = "hush_ringtone_v1";
const STORE_NAME = "ringtones";

let inMemoryStore: CustomRingtoneRecord | null = null;
let cachedCustomRingtone: CustomRingtoneRecord | null = null;
const listeners = new Set<() => void>();

function notifySubscribers() {
  listeners.forEach((fn) => {
    try {
      fn();
    } catch {}
  });
}

function openRingtoneDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    try {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: "id" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function loadCustomRingtone(): Promise<CustomRingtoneRecord | null> {
  const db = await openRingtoneDb();
  if (!db) {
    cachedCustomRingtone = inMemoryStore;
    notifySubscribers();
    return inMemoryStore;
  }
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const req = store.get("active");
      req.onsuccess = () => {
        const record = (req.result as CustomRingtoneRecord) || null;
        cachedCustomRingtone = record;
        notifySubscribers();
        resolve(record);
      };
      req.onerror = () => {
        resolve(cachedCustomRingtone);
      };
    } catch {
      resolve(cachedCustomRingtone);
    } finally {
      db.close();
    }
  });
}

export async function saveCustomRingtone(file: File): Promise<CustomRingtoneRecord> {
  if (file.size > 15 * 1024 * 1024) {
    throw new Error("Il file audio non può superare 15 MB");
  }

  const isAudio =
    file.type.startsWith("audio/") ||
    /\.(mp3|wav|ogg|m4a|aac|flac|weba)$/i.test(file.name);

  if (!isAudio) {
    throw new Error("Seleziona un file audio valido (MP3, WAV, OGG, M4A)");
  }

  const record: CustomRingtoneRecord = {
    id: "active",
    name: file.name,
    size: file.size,
    type: file.type || "audio/mpeg",
    data: file,
    updatedAt: Date.now(),
  };

  const db = await openRingtoneDb();
  if (!db) {
    inMemoryStore = record;
    cachedCustomRingtone = record;
    notifySubscribers();
    return record;
  }

  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const req = store.put(record);
      req.onsuccess = () => {
        cachedCustomRingtone = record;
        notifySubscribers();
        resolve(record);
      };
      req.onerror = () => reject(req.error || new Error("Errore nel salvataggio della suoneria"));
    } catch (err) {
      reject(err);
    } finally {
      db.close();
    }
  });
}

export async function removeCustomRingtone(): Promise<void> {
  inMemoryStore = null;
  const db = await openRingtoneDb();
  if (!db) {
    cachedCustomRingtone = null;
    notifySubscribers();
    return;
  }

  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const req = store.delete("active");
      req.onsuccess = () => {
        cachedCustomRingtone = null;
        notifySubscribers();
        resolve();
      };
      req.onerror = () => reject(req.error || new Error("Errore durante la rimozione della suoneria"));
    } catch (err) {
      reject(err);
    } finally {
      db.close();
    }
  });
}

export function getCustomRingtone(): CustomRingtoneRecord | null {
  return cachedCustomRingtone;
}

export function subscribeCustomRingtone(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useCustomRingtone(): CustomRingtoneRecord | null {
  return useSyncExternalStore(subscribeCustomRingtone, () => cachedCustomRingtone);
}

// Web Audio API Synthesizer (Fallback & Default)
let activeRingtoneContext: AudioContext | null = null;
let ringtoneInterval: number | null = null;
let ringtoneTimeout: number | null = null;
let activeAudioElement: HTMLAudioElement | null = null;
let activeAudioUrl: string | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const AudioCtx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) return null;

  if (!activeRingtoneContext || activeRingtoneContext.state === "closed") {
    try {
      activeRingtoneContext = new AudioCtx();
    } catch {
      return null;
    }
  }

  if (activeRingtoneContext.state === "suspended") {
    void activeRingtoneContext.resume().catch(() => {});
  }

  return activeRingtoneContext;
}

function playChime(ctx: AudioContext) {
  try {
    const now = ctx.currentTime;

    // First note (523.25 Hz - C5)
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = "sine";
    osc1.frequency.setValueAtTime(523.25, now);
    osc1.frequency.exponentialRampToValueAtTime(587.33, now + 0.15);
    gain1.gain.setValueAtTime(0, now);
    gain1.gain.linearRampToValueAtTime(0.18, now + 0.04);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.5);

    // Second note (659.25 Hz - E5)
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = "sine";
    osc2.frequency.setValueAtTime(659.25, now + 0.18);
    osc2.frequency.exponentialRampToValueAtTime(783.99, now + 0.35);
    gain2.gain.setValueAtTime(0, now + 0.18);
    gain2.gain.linearRampToValueAtTime(0.22, now + 0.22);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.75);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(now + 0.18);
    osc2.stop(now + 0.8);

    // Soft harmonizing overtone (1046.5 Hz - C6)
    const osc3 = ctx.createOscillator();
    const gain3 = ctx.createGain();
    osc3.type = "sine";
    osc3.frequency.setValueAtTime(1046.5, now + 0.2);
    gain3.gain.setValueAtTime(0, now + 0.2);
    gain3.gain.linearRampToValueAtTime(0.08, now + 0.24);
    gain3.gain.exponentialRampToValueAtTime(0.001, now + 0.7);
    osc3.connect(gain3);
    gain3.connect(ctx.destination);
    osc3.start(now + 0.2);
    osc3.stop(now + 0.75);
  } catch {
    // Audio synthesis failure should not crash
  }
}

function fallbackToSynth(interval: number) {
  const ctx = getAudioContext();
  if (ctx) {
    playChime(ctx);
    ringtoneInterval = globalThis.setInterval(() => {
      if (activeRingtoneContext && activeRingtoneContext.state !== "closed") {
        playChime(activeRingtoneContext);
      }
    }, interval) as unknown as number;
  }
}

export type RingtoneOptions = {
  durationMs?: number; // default ~30000ms (30s)
  intervalMs?: number; // default 2200ms
  onEnd?: () => void;
};

/**
 * Starts the incoming call ringtone.
 * Plays the custom MP3 file if configured, otherwise falls back to melodic chimes.
 * Returns a function to cancel/stop the ringtone immediately.
 */
export function startIncomingCallRingtone(options?: RingtoneOptions): () => void {
  // Stop any previously playing ringtone first
  stopIncomingCallRingtone();

  const duration = options?.durationMs ?? 30000;
  const interval = options?.intervalMs ?? 2200;

  if (cachedCustomRingtone && typeof window !== "undefined" && typeof Audio !== "undefined") {
    try {
      const url = URL.createObjectURL(cachedCustomRingtone.data);
      const audio = new Audio(url);
      audio.loop = true;

      // Apply output volume & routing from media settings
      try {
        const mediaRaw = localStorage.getItem("hush:media:v1");
        if (mediaRaw) {
          const parsed = JSON.parse(mediaRaw);
          if (typeof parsed.outputVolume === "number") {
            audio.volume = Math.min(1, Math.max(0, parsed.outputVolume / 100));
          }
          if (parsed.outputId && "setSinkId" in audio) {
            void (audio as any).setSinkId(parsed.outputId).catch(() => {});
          }
        }
      } catch {}

      activeAudioElement = audio;
      activeAudioUrl = url;

      const playPromise = audio.play();
      if (playPromise) {
        playPromise.catch(() => {
          fallbackToSynth(interval);
        });
      }
    } catch {
      fallbackToSynth(interval);
    }
  } else {
    fallbackToSynth(interval);
  }

  ringtoneTimeout = globalThis.setTimeout(() => {
    stopIncomingCallRingtone();
    options?.onEnd?.();
  }, duration) as unknown as number;

  return stopIncomingCallRingtone;
}

export function stopIncomingCallRingtone() {
  if (activeAudioElement) {
    try {
      activeAudioElement.pause();
      activeAudioElement.currentTime = 0;
      activeAudioElement.src = "";
    } catch {}
    activeAudioElement = null;
  }
  if (activeAudioUrl) {
    try {
      URL.revokeObjectURL(activeAudioUrl);
    } catch {}
    activeAudioUrl = null;
  }
  if (ringtoneInterval !== null) {
    globalThis.clearInterval(ringtoneInterval);
    ringtoneInterval = null;
  }
  if (ringtoneTimeout !== null) {
    globalThis.clearTimeout(ringtoneTimeout);
    ringtoneTimeout = null;
  }
}

// Auto-preload from IndexedDB on startup
if (typeof window !== "undefined") {
  void loadCustomRingtone().catch(() => {});
}
