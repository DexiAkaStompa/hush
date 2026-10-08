import { decryptBinary, encryptBinary } from "./crypto";
import { supabase } from "./supabase";
import { downloadSharedMedia, isSharedMediaConfigured, uploadSharedMedia } from "./shared-media";

export type ChatAttachmentMeta = {
  id: string;
  path: string;
  name: string;
  type: string;
  size: number;
  iv: string;
  storage?: "supabase" | "gdrive" | "gdrive-shared";
  gdrive_file_id?: string;
  download_url?: string;
};

export const CHAT_IMAGE_LIMIT = 16 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set([ "image/png", "image/jpeg", "image/gif", "image/webp" ]);

export function validateChatImage(file: Pick<File, "type" | "size">) {
  if (!ALLOWED_MIME_TYPES.has(file.type)) {
    throw new Error("Scegli un'immagine PNG, JPG, GIF o WebP.");
  }
  if (file.size === 0 || file.size > CHAT_IMAGE_LIMIT) {
    throw new Error("L'immagine deve essere compresa tra 1 byte e 16 MB.");
  }
}

export function validateChatFile(file: Pick<File, "type" | "size">) {
  if (file.size < 1 || file.size > CHAT_IMAGE_LIMIT - 16) throw new Error("Il file deve essere compreso tra 1 byte e 16 MB.");
}
export async function uploadEncryptedChatImage(file: File, conversationId: string, roomKey: CryptoKey): Promise<ChatAttachmentMeta> {
  validateChatImage(file);
  return uploadEncryptedChatFile(file, conversationId, roomKey);
}

export async function uploadEncryptedChatFile(
  file: File,
  conversationId: string,
  roomKey: CryptoKey,
): Promise<ChatAttachmentMeta> {
  validateChatFile(file);

  const buffer = await file.arrayBuffer();
  const context = `hush:attachment:${conversationId}`;
  const { iv, ciphertext } = await encryptBinary(buffer, roomKey, context);

  const fileId = crypto.randomUUID();

  if (isSharedMediaConfigured) {
    const driveId = await uploadSharedMedia(conversationId, fileId, ciphertext);
    return { id: fileId, path: `gdrive-shared:${driveId}`, name: file.name || "immagine", type: file.type || "application/octet-stream", size: file.size, iv, storage: "gdrive-shared", gdrive_file_id: driveId };
  }

  // If Google Drive 5TB storage is active in desktop app, upload there
  const desktop = typeof window !== "undefined" ? window.hushWindow : undefined;
  const isGDriveActive = desktop?.isGDriveConfigured ? await desktop.isGDriveConfigured().catch(() => false) : false;

  if (isGDriveActive && desktop?.uploadGDriveMedia) {
    try {
      const gdriveResult = await desktop.uploadGDriveMedia({
        name: `${conversationId}-${fileId}.bin`,
        data: new Uint8Array(ciphertext),
        mimeType: "application/octet-stream",
      });

      return {
        id: fileId,
        path: `gdrive:${gdriveResult.fileId}`,
        name: file.name || "immagine",
        type: file.type || "application/octet-stream",
        size: file.size,
        iv,
        storage: "gdrive",
        gdrive_file_id: gdriveResult.fileId,
        download_url: gdriveResult.downloadUrl,
      };
    } catch (gdriveErr) {
      console.error("Upload Google Drive non riuscito:", gdriveErr);
      throw new Error("Caricamento su Google Drive fallito: " + (gdriveErr instanceof Error ? gdriveErr.message : String(gdriveErr)));
    }
  }

  // Fallback to Supabase Storage
  if (!supabase) throw new Error("Connessione a Supabase non disponibile.");
  const path = `${conversationId}/${fileId}.bin`;
  const client = supabase;
  const bucket = client.storage.from("chat-media");

  const blob = new Blob([ciphertext], { type: "application/octet-stream" });
  const { error } = await bucket.upload(path, blob, {
    contentType: "application/octet-stream",
    upsert: false,
    cacheControl: "31536000",
  });

  if (error) {
    if (error.message && /bucket not found/i.test(error.message)) {
      throw new Error("Il bucket chat-media non esiste ancora su Supabase. Applica la migrazione chat_media.");
    }
    throw error;
  }

  return {
    id: fileId,
    path,
    name: file.name || "immagine",
    type: file.type || "application/octet-stream",
    size: file.size,
    iv,
    storage: "supabase",
  };
}

type DecryptedUrlEntry = {
  path: string;
  conversationId: string;
  roomKey: CryptoKey;
  url: string;
  // A leased URL is in use by a mounted attachment and must not be evicted.
  consumers: number;
  size: number;
  lastUsed: number;
};

const decryptedUrlCache = new Map<string, DecryptedUrlEntry>();
const pendingDecryptedUrls = new Map<string, Promise<string>>();
const roomKeyIds = new WeakMap<object, number>();
let nextRoomKeyId = 1;
let cacheGeneration = 0;
const MAX_DECRYPTED_CACHE_ENTRIES = 24;
const MAX_DECRYPTED_CACHE_BYTES = 64 * 1024 * 1024;
let decryptedCacheBytes = 0;

function evictIdleDecryptedUrls() {
  while (decryptedUrlCache.size > MAX_DECRYPTED_CACHE_ENTRIES || decryptedCacheBytes > MAX_DECRYPTED_CACHE_BYTES) {
    const oldestIdle = [...decryptedUrlCache.entries()]
      .filter(([, entry]) => entry.consumers === 0)
      .sort(([, left], [, right]) => left.lastUsed - right.lastUsed)[0];
    if (!oldestIdle) break;
    const [path, entry] = oldestIdle;
    URL.revokeObjectURL(entry.url);
    decryptedUrlCache.delete(path);
    decryptedCacheBytes -= entry.size;
  }
}

function cacheKey(path: string, conversationId: string, roomKey: CryptoKey) {
  let roomKeyId = roomKeyIds.get(roomKey);
  if (!roomKeyId) {
    roomKeyId = nextRoomKeyId++;
    roomKeyIds.set(roomKey, roomKeyId);
  }
  return `${conversationId}\u0000${roomKeyId}\u0000${path}`;
}

function retainDecryptedUrl(key: string): string | null {
  const entry = decryptedUrlCache.get(key);
  if (!entry) return null;
  entry.consumers += 1;
  entry.lastUsed = Date.now();
  return entry.url;
}

export async function downloadAndDecryptChatImage(
  attachment: ChatAttachmentMeta,
  conversationId: string,
  roomKey: CryptoKey,
): Promise<string> {
  const key = cacheKey(attachment.path, conversationId, roomKey);
  const cached = retainDecryptedUrl(key);
  if (cached) return cached;

  const pending = pendingDecryptedUrls.get(key);
  if (pending) {
    const url = await pending;
    const retained = retainDecryptedUrl(key);
    if (!retained) throw new Error("L’immagine è stata invalidata durante il caricamento.");
    return retained;
  }

  const generation = cacheGeneration;
  const load = (async () => {
    let encryptedBuffer: ArrayBuffer;

  if (attachment.storage === "gdrive-shared" || attachment.path.startsWith("gdrive-shared:")) {
    const fileId = attachment.gdrive_file_id || attachment.path.slice("gdrive-shared:".length);
    encryptedBuffer = await downloadSharedMedia(conversationId, fileId);
  } else if (attachment.storage === "gdrive" || attachment.path.startsWith("gdrive:") || attachment.gdrive_file_id) {
    const fileId = attachment.gdrive_file_id || attachment.path.replace(/^gdrive:/, "");
    const desktop = typeof window !== "undefined" ? window.hushWindow : undefined;

    let buf: ArrayBuffer | null = null;
    if (desktop?.downloadGDriveMedia) {
      try {
        const data = await desktop.downloadGDriveMedia({
          fileId,
          downloadUrl: attachment.download_url,
        });
        const uint8 = data instanceof Uint8Array ? data : new Uint8Array(data);
        const copy = new Uint8Array(uint8.byteLength);
        copy.set(uint8);
        buf = copy.buffer;
      } catch (err) {
        console.warn("Desktop GDrive download failed, falling back to direct fetch:", err);
      }
    }

    if (!buf) {
      const urls = [
        attachment.download_url,
        `https://drive.usercontent.google.com/download?id=${fileId}&export=download&authuser=0`,
        `https://drive.google.com/uc?export=download&id=${fileId}`,
      ].filter(Boolean) as string[];

      let response: Response | null = null;
      for (const url of urls) {
        try {
          const res = await fetch(url);
          if (res.ok) {
            response = res;
            break;
          }
        } catch {}
      }

      if (!response || !response.ok) {
        throw new Error("Impossibile scaricare l'allegato da Google Drive.");
      }
      buf = await response.arrayBuffer();
    }
    encryptedBuffer = buf;
    } else {
      if (!supabase) throw new Error("Connessione a Supabase non disponibile.");
      const { data, error } = await supabase.storage.from("chat-media").download(attachment.path);
      if (error || !data) throw error || new Error("Impossibile scaricare l’allegato.");
      encryptedBuffer = await data.arrayBuffer();
    }

    const context = `hush:attachment:${conversationId}`;
    const decryptedBuffer = await decryptBinary(encryptedBuffer, attachment.iv, roomKey, context);

    const blob = new Blob([decryptedBuffer], { type: attachment.type });
    const objectUrl = URL.createObjectURL(blob);
    if (generation !== cacheGeneration) {
      URL.revokeObjectURL(objectUrl);
      throw new Error("L’immagine è stata invalidata durante il caricamento.");
    }
    decryptedUrlCache.set(key, {
      path: attachment.path,
      conversationId,
      roomKey,
      url: objectUrl,
      consumers: 1,
      size: decryptedBuffer.byteLength,
      lastUsed: Date.now(),
    });
    decryptedCacheBytes += decryptedBuffer.byteLength;
    evictIdleDecryptedUrls();
    return objectUrl;
  })();
  pendingDecryptedUrls.set(key, load);
  try {
    const url = await load;
    if (!decryptedUrlCache.has(key)) throw new Error("Immagine invalidata durante il caricamento.");
    return url;
  } finally {
    if (pendingDecryptedUrls.get(key) === load) pendingDecryptedUrls.delete(key);
  }
}

/** Releases one mounted attachment's lease on its decrypted object URL. */
export function releaseChatMediaCacheEntry(path: string, url: string) {
  const entry = [...decryptedUrlCache.values()].find((candidate) => candidate.path === path && candidate.url === url);
  if (!entry) return;
  entry.consumers = Math.max(0, entry.consumers - 1);
  entry.lastUsed = Date.now();
  evictIdleDecryptedUrls();
}

export function clearChatMediaCache() {
  for (const entry of decryptedUrlCache.values()) URL.revokeObjectURL(entry.url);
  decryptedUrlCache.clear();
  pendingDecryptedUrls.clear();
  decryptedCacheBytes = 0;
  cacheGeneration += 1;
}
