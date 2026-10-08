import { decryptBinary, encryptBinary } from "./crypto";
import { downloadSharedMedia, uploadSharedMedia } from "./shared-media";

export const MEDIA_CHUNK_BYTES = 8 * 1024 * 1024;
export type TransferOptions = { signal?: AbortSignal; onProgress?: (fraction: number) => void };
export type ChunkedAttachment = { id: string; size: number; iv: string; gdrive_file_id?: string; path: string };
type Manifest = { v: 1; size: number; chunkSize: number; chunks: number };

function chunkContext(conversationId: string, attachmentId: string, index: number) {
  return `hush:attachment:${conversationId}:${attachmentId}:chunk:${index}`;
}

export async function uploadChunkedMedia(file: File, conversationId: string, attachmentId: string, key: CryptoKey, options: TransferOptions = {}) {
  const chunks = Math.ceil(file.size / MEDIA_CHUNK_BYTES);
  for (let index = 0; index < chunks; index++) {
    options.signal?.throwIfAborted();
    const plain = await file.slice(index * MEDIA_CHUNK_BYTES, (index + 1) * MEDIA_CHUNK_BYTES).arrayBuffer();
    const encrypted = await encryptBinary(plain, key, chunkContext(conversationId, attachmentId, index));
    const bytes = new Uint8Array(12 + encrypted.ciphertext.byteLength);
    bytes.set(Uint8Array.from(atob(encrypted.iv), char => char.charCodeAt(0)));
    bytes.set(new Uint8Array(encrypted.ciphertext), 12);
    await uploadSharedMedia(conversationId, attachmentId, bytes.buffer, index, options.signal);
    options.onProgress?.(Math.min(0.99, ((index + 1) / chunks) * 0.99));
  }
  options.signal?.throwIfAborted();
  const manifest: Manifest = { v: 1, size: file.size, chunkSize: MEDIA_CHUNK_BYTES, chunks };
  const encrypted = await encryptBinary(new TextEncoder().encode(JSON.stringify(manifest)).buffer, key, `hush:attachment:${conversationId}`);
  // Publish the encrypted manifest last. Incomplete uploads never appear in chats.
  const fileId = await uploadSharedMedia(conversationId, attachmentId, encrypted.ciphertext, undefined, options.signal);
  options.onProgress?.(1);
  return { fileId, iv: encrypted.iv };
}

export async function downloadChunkedMedia(attachment: ChunkedAttachment, conversationId: string, key: CryptoKey, write: (bytes: Uint8Array<ArrayBuffer>) => Promise<void>, options: TransferOptions = {}) {
  const fileId = attachment.gdrive_file_id || attachment.path.slice("gdrive-shared:".length);
  options.signal?.throwIfAborted();
  const encrypted = await downloadSharedMedia(conversationId, fileId, undefined, options.signal);
  const decoded = await decryptBinary(encrypted, attachment.iv, key, `hush:attachment:${conversationId}`);
  const manifest = JSON.parse(new TextDecoder().decode(decoded)) as Manifest;
  if (manifest.v !== 1 || !Number.isSafeInteger(manifest.size) || manifest.size < 1 || manifest.size !== attachment.size || manifest.chunkSize !== MEDIA_CHUNK_BYTES || manifest.chunks !== Math.ceil(manifest.size / MEDIA_CHUNK_BYTES)) throw new Error("Allegato non valido.");
  for (let index = 0; index < manifest.chunks; index++) {
    options.signal?.throwIfAborted();
    const bytes = await downloadSharedMedia(conversationId, fileId, index, options.signal);
    const expectedSize = Math.min(MEDIA_CHUNK_BYTES, manifest.size - index * MEDIA_CHUNK_BYTES);
    if (bytes.byteLength !== expectedSize + 28) throw new Error("Allegato incompleto o non più disponibile.");
    const nonce = btoa(String.fromCharCode(...new Uint8Array(bytes, 0, 12)));
    const plain = await decryptBinary(bytes.slice(12), nonce, key, chunkContext(conversationId, attachment.id, index));
    await write(new Uint8Array(plain));
    options.onProgress?.((index + 1) / manifest.chunks);
  }
}
