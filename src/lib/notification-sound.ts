/**
 * Notification sound manager.
 * Supports custom audio files (MP3, WAV, OGG) stored in IndexedDB,
 * with graceful fallback to a Web Audio API synthesized notification chime.
 */

import { useSyncExternalStore } from "react";

export type CustomNotificationRecord = {
  id: "active";
  name: string;
  size: number;
  type: string;
  data: Blob;
  updatedAt: number;
};

const DB_NAME = "hush_notification_sound_v1";
const STORE_NAME = "sounds";

let inMemoryStore: CustomNotificationRecord | null = null;
let cachedCustomSound: CustomNotificationRecord | null = null;
const listeners = new Set<() => void>();

function notifySubscribers() {
  listeners.forEach((fn) => {
    try {
      fn();
    } catch {}
  });
}

function openDatabase(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
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

export async function loadCustomNotificationSound(): Promise<CustomNotificationRecord | null> {
  const db = await openDatabase();
  if (!db) {
    cachedCustomSound = inMemoryStore;
    notifySubscribers();
    return inMemoryStore;
  }
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const req = store.get("active");
      req.onsuccess = () => {
        const record = (req.result as CustomNotificationRecord) || null;
        cachedCustomSound = record;
        notifySubscribers();
        resolve(record);
      };
      req.onerror = () => resolve(cachedCustomSound);
    } catch {
      resolve(cachedCustomSound);
    } finally {
      db.close();
    }
  });
}

export async function saveCustomNotificationSound(file: File): Promise<CustomNotificationRecord> {
  if (file.size > 10 * 1024 * 1024) {
    throw new Error("Il file audio non può superare 10 MB");
  }

  const isAudio =
    file.type.startsWith("audio/") ||
    /\.(mp3|wav|ogg|m4a|aac|flac|weba)$/i.test(file.name);

  if (!isAudio) {
    throw new Error("Seleziona un file audio valido (MP3, WAV, OGG, M4A)");
  }

  const record: CustomNotificationRecord = {
    id: "active",
    name: file.name,
    size: file.size,
    type: file.type || "audio/mpeg",
    data: file,
    updatedAt: Date.now(),
  };

  const db = await openDatabase();
  if (!db) {
    inMemoryStore = record;
    cachedCustomSound = record;
    notifySubscribers();
    return record;
  }

  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const req = store.put(record);
      req.onsuccess = () => {
        cachedCustomSound = record;
        notifySubscribers();
        resolve(record);
      };
      req.onerror = () => reject(req.error || new Error("Errore nel salvataggio del suono"));
    } catch (err) {
      reject(err);
    } finally {
      db.close();
    }
  });
}

export async function removeCustomNotificationSound(): Promise<void> {
  inMemoryStore = null;
  const db = await openDatabase();
  if (!db) {
    cachedCustomSound = null;
    notifySubscribers();
    return;
  }

  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const req = store.delete("active");
      req.onsuccess = () => {
        cachedCustomSound = null;
        notifySubscribers();
        resolve();
      };
      req.onerror = () => reject(req.error || new Error("Errore durante la rimozione del suono"));
    } catch (err) {
      reject(err);
    } finally {
      db.close();
    }
  });
}

export function getCustomNotificationSound(): CustomNotificationRecord | null {
  return cachedCustomSound;
}

export function subscribeCustomNotificationSound(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useCustomNotificationSound(): CustomNotificationRecord | null {
  return useSyncExternalStore(subscribeCustomNotificationSound, () => cachedCustomSound);
}

// Web Audio API Synthesizer (Default chime)
let audioContext: AudioContext | null = null;

function getContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const AudioCtx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) return null;

  if (!audioContext || audioContext.state === "closed") {
    try {
      audioContext = new AudioCtx();
    } catch {
      return null;
    }
  }

  if (audioContext.state === "suspended") {
    void audioContext.resume().catch(() => {});
  }

  return audioContext;
}

function playDefaultChime() {
  const ctx = getContext();
  if (!ctx) return;
  try {
    const now = ctx.currentTime;

    // Note 1: 659.25 Hz (E5)
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = "sine";
    osc1.frequency.setValueAtTime(659.25, now);
    gain1.gain.setValueAtTime(0, now);
    gain1.gain.linearRampToValueAtTime(0.18, now + 0.02);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.4);

    // Note 2: 880 Hz (A5)
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = "sine";
    osc2.frequency.setValueAtTime(880, now + 0.08);
    gain2.gain.setValueAtTime(0, now + 0.08);
    gain2.gain.linearRampToValueAtTime(0.22, now + 0.1);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(now + 0.08);
    osc2.stop(now + 0.55);
  } catch {}
}

let activePreviewAudio: HTMLAudioElement | null = null;
let activePreviewUrl: string | null = null;

export function playMessageNotificationSound(): void {
  if (cachedCustomSound && typeof window !== "undefined" && typeof Audio !== "undefined") {
    try {
      const url = URL.createObjectURL(cachedCustomSound.data);
      const audio = new Audio(url);

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

      audio.onended = () => {
        URL.revokeObjectURL(url);
      };
      audio.onerror = () => {
        URL.revokeObjectURL(url);
        playDefaultChime();
      };

      const playPromise = audio.play();
      if (playPromise) {
        playPromise.catch(() => {
          URL.revokeObjectURL(url);
          playDefaultChime();
        });
      }
    } catch {
      playDefaultChime();
    }
  } else {
    playDefaultChime();
  }
}

export function stopNotificationPreview(): void {
  if (activePreviewAudio) {
    try {
      activePreviewAudio.pause();
      activePreviewAudio.src = "";
    } catch {}
    activePreviewAudio = null;
  }
  if (activePreviewUrl) {
    try {
      URL.revokeObjectURL(activePreviewUrl);
    } catch {}
    activePreviewUrl = null;
  }
}

export function previewNotificationSound(): () => void {
  stopNotificationPreview();
  if (cachedCustomSound && typeof window !== "undefined" && typeof Audio !== "undefined") {
    try {
      const url = URL.createObjectURL(cachedCustomSound.data);
      const audio = new Audio(url);
      activePreviewAudio = audio;
      activePreviewUrl = url;
      audio.onended = () => {
        stopNotificationPreview();
      };
      void audio.play().catch(() => {
        stopNotificationPreview();
        playDefaultChime();
      });
    } catch {
      playDefaultChime();
    }
  } else {
    playDefaultChime();
  }
  return stopNotificationPreview;
}

if (typeof window !== "undefined") {
  void loadCustomNotificationSound().catch(() => {});
}
