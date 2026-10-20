/**
 * Notification sound manager.
 * Supports custom audio files (MP3, WAV, OGG) stored in IndexedDB,
 * with bundled notification audio as the default.
 */

import { useSyncExternalStore } from "react";
import { configureSoundOutput, soundPackUrl } from "./sound-pack";

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

let activePreviewAudio: HTMLAudioElement | null = null;
let activePreviewUrl: string | null = null;

function createNotificationAudio(): { audio: HTMLAudioElement; url: string | null } {
  const url = cachedCustomSound ? URL.createObjectURL(cachedCustomSound.data) : null;
  const audio = new Audio(url ?? soundPackUrl("message1"));
  configureSoundOutput(audio);
  return { audio, url };
}

export function playMessageNotificationSound(): void {
  if (typeof Audio === "undefined") return;
  try {
    const { audio, url } = createNotificationAudio();
    const cleanup = () => { if (url) URL.revokeObjectURL(url); };
    audio.onended = cleanup;
    audio.onerror = cleanup;
    void audio.play().catch(cleanup);
  } catch {}
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
  if (typeof Audio !== "undefined") {
    try {
      const { audio, url } = createNotificationAudio();
      activePreviewAudio = audio;
      activePreviewUrl = url;
      const cleanup = () => { if (activePreviewAudio === audio) stopNotificationPreview(); };
      audio.onended = cleanup;
      audio.onerror = cleanup;
      void audio.play().catch(cleanup);
    } catch {}
  }
  return stopNotificationPreview;
}

if (typeof window !== "undefined") {
  void loadCustomNotificationSound().catch(() => {});
}
