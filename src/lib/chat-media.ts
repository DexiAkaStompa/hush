import { decryptBinary, encryptBinary } from "./crypto";
import { supabase } from "./supabase";

export type ChatAttachmentMeta = {
  id: string;
  path: string;
  name: string;
  type: string;
  size: number;
  iv: string;
  storage?: "supabase" | "gdrive";
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

export async function uploadEncryptedChatImage(
  file: File,
  conversationId: string,
  roomKey: CryptoKey,
): Promise<ChatAttachmentMeta> {
  validateChatImage(file);

  const buffer = await file.arrayBuffer();
  const context = `hush:attachment:${conversationId}`;
  const { iv, ciphertext } = await encryptBinary(buffer, roomKey, context);

  const fileId = crypto.randomUUID();

  // If Google Drive 5TB storage is active in desktop app, upload there
  const desktop = typeof window !== "undefined" ? window.hushWindow : undefined;
  const isGDriveActive = desktop?.isGDriveConfigured ? await desktop.isGDriveConfigured().catch(() => false) : false;

  if (isGDriveActive && desktop?.uploadGDriveMedia) {
    const gdriveResult = await desktop.uploadGDriveMedia({
      name: `${conversationId}-${fileId}.bin`,
      data: Array.from(new Uint8Array(ciphertext)),
      mimeType: "application/octet-stream",
    });

    return {
      id: fileId,
      path: `gdrive:${gdriveResult.fileId}`,
      name: file.name || "immagine",
      type: file.type,
      size: file.size,
      iv,
      storage: "gdrive",
      gdrive_file_id: gdriveResult.fileId,
      download_url: gdriveResult.downloadUrl,
    };
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
    type: file.type,
    size: file.size,
    iv,
    storage: "supabase",
  };
}

const decryptedUrlCache = new Map<string, string>();

export async function downloadAndDecryptChatImage(
  attachment: ChatAttachmentMeta,
  conversationId: string,
  roomKey: CryptoKey,
): Promise<string> {
  const cached = decryptedUrlCache.get(attachment.path);
  if (cached) return cached;

  let encryptedBuffer: ArrayBuffer;

  if (attachment.storage === "gdrive" || attachment.path.startsWith("gdrive:") || attachment.gdrive_file_id) {
    const fileId = attachment.gdrive_file_id || attachment.path.replace(/^gdrive:/, "");
    const downloadUrl = attachment.download_url || `https://drive.usercontent.google.com/download?id=${fileId}&export=download&authuser=0`;
    const response = await fetch(downloadUrl).catch(() => null);
    if (!response || !response.ok) {
      const fallbackUrl = `https://drive.google.com/uc?export=download&id=${fileId}`;
      const fallbackRes = await fetch(fallbackUrl);
      if (!fallbackRes.ok) throw new Error("Impossibile scaricare l'allegato da Google Drive.");
      encryptedBuffer = await fallbackRes.arrayBuffer();
    } else {
      encryptedBuffer = await response.arrayBuffer();
    }
  } else {
    if (!supabase) throw new Error("Connessione a Supabase non disponibile.");
    const { data, error } = await supabase.storage.from("chat-media").download(attachment.path);
    if (error || !data) throw error || new Error("Impossibile scaricare l'allegato.");
    encryptedBuffer = await data.arrayBuffer();
  }

  const context = `hush:attachment:${conversationId}`;
  const decryptedBuffer = await decryptBinary(encryptedBuffer, attachment.iv, roomKey, context);

  const blob = new Blob([decryptedBuffer], { type: attachment.type });
  const objectUrl = URL.createObjectURL(blob);
  decryptedUrlCache.set(attachment.path, objectUrl);
  return objectUrl;
}

export function clearChatMediaCache() {
  for (const url of decryptedUrlCache.values()) URL.revokeObjectURL(url);
  decryptedUrlCache.clear();
}
