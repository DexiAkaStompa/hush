import type { ChatAttachmentMeta } from "./chat-media";
import {
  downloadAndDecryptChatImage,
  releaseChatMediaCacheEntry,
} from "./chat-media";
import { downloadSharedMedia } from "./shared-media";
import { downloadChunkedMedia, type TransferOptions } from "./chunked-media";
import { decryptBinary } from "./crypto";
export const MAX_INLINE_MEDIA_BYTES = 128 * 1024 * 1024;
export type PlayableMedia = { kind: "audio" | "video"; mime: string };
const mimeTypes: Record<string, PlayableMedia> = {
  "audio/wav": { kind: "audio", mime: "audio/wav" },
  "audio/x-wav": { kind: "audio", mime: "audio/wav" },
  "audio/wave": { kind: "audio", mime: "audio/wav" },
  "audio/vnd.wave": { kind: "audio", mime: "audio/wav" },
  "audio/mpeg": { kind: "audio", mime: "audio/mpeg" },
  "audio/mp3": { kind: "audio", mime: "audio/mpeg" },
  "audio/mp4": { kind: "audio", mime: "audio/mp4" },
  "audio/x-m4a": { kind: "audio", mime: "audio/mp4" },
  "audio/aac": { kind: "audio", mime: "audio/aac" },
  "audio/ogg": { kind: "audio", mime: "audio/ogg" },
  "audio/opus": { kind: "audio", mime: "audio/ogg" },
  "audio/flac": { kind: "audio", mime: "audio/flac" },
  "audio/x-flac": { kind: "audio", mime: "audio/flac" },
  "audio/webm": { kind: "audio", mime: "audio/webm" },
  "video/mp4": { kind: "video", mime: "video/mp4" },
  "video/webm": { kind: "video", mime: "video/webm" },
  "video/ogg": { kind: "video", mime: "video/ogg" },
  "video/quicktime": { kind: "video", mime: "video/quicktime" },
  "video/x-m4v": { kind: "video", mime: "video/mp4" },
};
const extensions: Record<string, string> = {
  wav: "audio/wav",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  aac: "audio/aac",
  ogg: "audio/ogg",
  opus: "audio/ogg",
  flac: "audio/flac",
  mp4: "video/mp4",
  m4v: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  ogv: "video/ogg",
};
export function playableMedia(
  attachment: Pick<ChatAttachmentMeta, "name" | "type">,
): PlayableMedia | null {
  const mime = attachment.type.split(";")[0].trim().toLowerCase();
  if (mimeTypes[mime]) return mimeTypes[mime];
  if (
    mime &&
    !["application/octet-stream", "binary/octet-stream"].includes(mime)
  )
    return null;
  return (
    mimeTypes[
      extensions[attachment.name.split(".").pop()?.toLowerCase() ?? ""]
    ] ?? null
  );
}
export type MediaPreview = { url: string; dispose: () => void };
export async function loadMediaPreview(
  attachment: ChatAttachmentMeta,
  conversationId: string,
  key: CryptoKey,
  options: TransferOptions = {},
): Promise<MediaPreview> {
  const format = playableMedia(attachment);
  if (!format)
    throw new Error("Questo file non supporta la riproduzione in app.");
  if (
    !Number.isSafeInteger(attachment.size) ||
    attachment.size < 1 ||
    attachment.size > MAX_INLINE_MEDIA_BYTES
  )
    throw new Error(
      "Questo file è troppo grande per l’anteprima. Scaricalo per riprodurlo.",
    );
  options.signal?.throwIfAborted();
  let blob: Blob;
  if (attachment.encryption === "chunked-v1") {
    const parts: Blob[] = [];
    await downloadChunkedMedia(
      attachment,
      conversationId,
      key,
      async (bytes) => {
        parts.push(new Blob([bytes]));
      },
      options,
    );
    blob = new Blob(parts, { type: format.mime });
  } else if (
    attachment.storage === "gdrive-shared" ||
    attachment.path.startsWith("gdrive-shared:")
  ) {
    const fileId =
      attachment.gdrive_file_id ||
      attachment.path.slice("gdrive-shared:".length);
    const ciphertext = await downloadSharedMedia(
      conversationId,
      fileId,
      undefined,
      options.signal,
    );
    options.signal?.throwIfAborted();
    const bytes = await decryptBinary(
      ciphertext,
      attachment.iv,
      key,
      `hush:attachment:${conversationId}`,
    );
    blob = new Blob([bytes], { type: format.mime });
    options.onProgress?.(1);
  } else {
    const cached = await downloadAndDecryptChatImage(
      attachment,
      conversationId,
      key,
    );
    try {
      options.signal?.throwIfAborted();
      blob = new Blob(
        [await (await fetch(cached, { signal: options.signal })).blob()],
        { type: format.mime },
      );
    } finally {
      releaseChatMediaCacheEntry(attachment.path, cached, true);
    }
  }
  options.signal?.throwIfAborted();
  if (blob.size !== attachment.size)
    throw new Error("L’allegato è incompleto o non valido.");
  const url = URL.createObjectURL(blob);
  let released = false;
  return {
    url,
    dispose: () => {
      if (!released) {
        released = true;
        URL.revokeObjectURL(url);
      }
    },
  };
}
