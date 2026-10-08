import { afterEach, beforeEach, test, expect, vi } from "vitest";
const mocks = vi.hoisted(() => ({ upload: vi.fn(), download: vi.fn(), sharedConfigured: false, sharedUpload: vi.fn() }));
vi.mock("./shared-media", () => ({
  get isSharedMediaConfigured() { return mocks.sharedConfigured; },
  uploadSharedMedia: mocks.sharedUpload,
  downloadSharedMedia: vi.fn(),
}));
vi.mock("./supabase", () => ({ supabase: {
  storage: { from: () => ({ upload: mocks.upload, download: mocks.download }) },
} }));

import { createRoomKey, decryptBinary } from "./crypto";
import {
  validateChatImage,
  uploadEncryptedChatImage,
  downloadAndDecryptChatImage,
  releaseChatMediaCacheEntry,
  clearChatMediaCache,
  CHAT_IMAGE_LIMIT,
} from "./chat-media";


beforeEach(() => {
  clearChatMediaCache();
  vi.resetAllMocks();
  mocks.sharedConfigured = false;
  mocks.upload.mockResolvedValue({ error: null });
});

afterEach(() => {
  clearChatMediaCache();
  delete (globalThis as unknown as { window?: unknown }).window;
});

async function encryptedFixture(conversationId: string, key: CryptoKey) {
  const rawBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
  const { encryptBinary } = await import("./crypto");
  return encryptBinary(rawBytes.buffer, key, `hush:attachment:${conversationId}`);
}

function fixtureAttachment(path: string, iv: string, id = path) {
  return { id, path, name: "test.png", type: "image/png", size: 4, iv, storage: "gdrive" as const, gdrive_file_id: path };
}


test("validateChatImage validates format and size", () => {
  expect(() => validateChatImage({ type: "image/png", size: 1024 })).not.toThrow();
  expect(() => validateChatImage({ type: "image/jpeg", size: 1024 })).not.toThrow();
  expect(() => validateChatImage({ type: "image/gif", size: 1024 })).not.toThrow();
  expect(() => validateChatImage({ type: "image/webp", size: 1024 })).not.toThrow();

  expect(() => validateChatImage({ type: "text/plain", size: 1024 })).toThrow();
  expect(() => validateChatImage({ type: "image/svg+xml", size: 1024 })).toThrow();
  expect(() => validateChatImage({ type: "image/png", size: 0 })).toThrow();
  expect(() => validateChatImage({ type: "image/png", size: CHAT_IMAGE_LIMIT + 1 })).toThrow();
});

test("uploadEncryptedChatImage encrypts file bytes and uploads to chat-media", async () => {
  const key = await createRoomKey();
  const rawBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
  const file = new File([rawBytes], "photo.png", { type: "image/png" });

  const meta = await uploadEncryptedChatImage(file, "conv123", key);
  expect(mocks.upload).toHaveBeenCalledOnce();
  const [path, blob, options] = mocks.upload.mock.calls[0];
  expect(path).match(/^conv123\/[0-9a-f-]+\.bin$/);
  expect(options.contentType).toBe("application/octet-stream");

  expect(meta.name).toBe("photo.png");
  expect(meta.type).toBe("image/png");
  expect(meta.iv).match(/^[A-Za-z0-9+/]+=*$/);
  expect(meta.storage).toBe("supabase");
});

test("shared Drive takes precedence and receives only encrypted bytes", async () => {
  mocks.sharedConfigured = true;
  mocks.sharedUpload.mockResolvedValue("shared-drive-file-id");
  const key = await createRoomKey();
  const plain = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
  const meta = await uploadEncryptedChatImage(new File([plain], "photo.png", { type: "image/png" }), "conv123", key);
  expect(meta.storage).toBe("gdrive-shared");
  expect(meta.gdrive_file_id).toBe("shared-drive-file-id");
  expect(mocks.upload).not.toHaveBeenCalled();
  const [conversationId, attachmentId, ciphertext] = mocks.sharedUpload.mock.calls[0];
  expect(conversationId).toBe("conv123");
  expect(attachmentId).toBe(meta.id);
  expect(new Uint8Array(ciphertext)).not.toEqual(plain);
  expect(new Uint8Array(await decryptBinary(ciphertext, meta.iv, key, "hush:attachment:conv123"))).toEqual(plain);
});

test("uploadEncryptedChatImage uploads to Google Drive when configured on desktop", async () => {
  const key = await createRoomKey();
  const rawBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
  const file = new File([rawBytes], "document.png", { type: "image/png" });

  const mockUpload = vi.fn().mockResolvedValue({
    fileId: "gdrive-12345",
    downloadUrl: "https://drive.usercontent.google.com/download?id=gdrive-12345",
  });

  (globalThis as unknown as { window: { hushWindow?: unknown } }).window = {
    hushWindow: {
      isGDriveConfigured: vi.fn().mockResolvedValue(true),
      uploadGDriveMedia: mockUpload,
    },
  };

  const meta = await uploadEncryptedChatImage(file, "conv-gdrive", key);
  expect(mockUpload).toHaveBeenCalledOnce();
  expect(meta.storage).toBe("gdrive");
  expect(meta.gdrive_file_id).toBe("gdrive-12345");
  expect(meta.path).toBe("gdrive:gdrive-12345");
  expect(mocks.upload).not.toHaveBeenCalled();

  delete (globalThis as unknown as { window?: unknown }).window;
});

test("downloadAndDecryptChatImage downloads and decrypts from Google Drive", async () => {
  const key = await createRoomKey();
  const rawBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
  const { encryptBinary } = await import("./crypto");
  const { iv, ciphertext } = await encryptBinary(rawBytes.buffer, key, "hush:attachment:conv-gdrive");

  const originalFetch = globalThis.fetch;
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: true,
    arrayBuffer: async () => ciphertext,
  } as unknown as Response);

  const url = await downloadAndDecryptChatImage(
    {
      id: "media-1",
      path: "gdrive:12345",
      name: "test.png",
      type: "image/png",
      size: rawBytes.length,
      iv,
      storage: "gdrive",
      gdrive_file_id: "12345",
    },
    "conv-gdrive",
    key,
  );

  expect(url).toMatch(/^blob:/);
  expect(globalThis.fetch).toHaveBeenCalledWith(
    "https://drive.usercontent.google.com/download?id=12345&export=download&authuser=0",
  );

  globalThis.fetch = originalFetch;
});

test("downloadAndDecryptChatImage uses desktop IPC download when available", async () => {
  const key = await createRoomKey();
  const rawBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
  const { encryptBinary } = await import("./crypto");
  const { iv, ciphertext } = await encryptBinary(rawBytes.buffer, key, "hush:attachment:conv-ipc");

  const mockDownload = vi.fn().mockResolvedValue(new Uint8Array(ciphertext));

  (globalThis as unknown as { window: { hushWindow?: unknown } }).window = {
    hushWindow: {
      downloadGDriveMedia: mockDownload,
    },
  };

  const url = await downloadAndDecryptChatImage(
    {
      id: "media-ipc",
      path: "gdrive:ipc-123",
      name: "test.png",
      type: "image/png",
      size: rawBytes.length,
      iv,
      storage: "gdrive",
      gdrive_file_id: "ipc-123",
    },
    "conv-ipc",
    key,
  );

  expect(mockDownload).toHaveBeenCalledWith({
    fileId: "ipc-123",
    downloadUrl: undefined,
  });
  expect(url).toMatch(/^blob:/);

  delete (globalThis as unknown as { window?: unknown }).window;
});

test("deduplicates concurrent cache misses and releases the final lease", async () => {
  const key = await createRoomKey();
  const { iv, ciphertext } = await encryptedFixture("conv-dedupe", key);
  let resolveDownload!: (value: Uint8Array) => void;
  const download = vi.fn().mockReturnValue(new Promise<Uint8Array>((resolve) => { resolveDownload = resolve; }));
  (globalThis as unknown as { window: { hushWindow: unknown } }).window = { hushWindow: { downloadGDriveMedia: download } };
  const createUrl = vi.spyOn(URL, "createObjectURL");
  const revokeUrl = vi.spyOn(URL, "revokeObjectURL");
  const attachment = fixtureAttachment("same-path", iv);

  const first = downloadAndDecryptChatImage(attachment, "conv-dedupe", key);
  const second = downloadAndDecryptChatImage(attachment, "conv-dedupe", key);
  resolveDownload(new Uint8Array(ciphertext));
  const [firstUrl, secondUrl] = await Promise.all([first, second]);

  expect(download).toHaveBeenCalledOnce();
  expect(createUrl).toHaveBeenCalledOnce();
  expect(firstUrl).toBe(secondUrl);
  releaseChatMediaCacheEntry(attachment.path, firstUrl);
  expect(revokeUrl).not.toHaveBeenCalled();
  releaseChatMediaCacheEntry(attachment.path, secondUrl);
  clearChatMediaCache();
  expect(revokeUrl).toHaveBeenCalledWith(firstUrl);
  createUrl.mockRestore();
  revokeUrl.mockRestore();
});

test("does not reuse a path across conversations or room keys", async () => {
  const keyA = await createRoomKey();
  const keyB = await createRoomKey();
  const firstFixture = await encryptedFixture("conv-a", keyA);
  const secondFixture = await encryptedFixture("conv-b", keyB);
  const download = vi.fn()
    .mockResolvedValueOnce(new Uint8Array(firstFixture.ciphertext))
    .mockResolvedValueOnce(new Uint8Array(secondFixture.ciphertext));
  (globalThis as unknown as { window: { hushWindow: unknown } }).window = { hushWindow: { downloadGDriveMedia: download } };
  const samePathA = fixtureAttachment("shared-path", firstFixture.iv);
  const samePathB = fixtureAttachment("shared-path", secondFixture.iv);

  const firstUrl = await downloadAndDecryptChatImage(samePathA, "conv-a", keyA);
  const secondUrl = await downloadAndDecryptChatImage(samePathB, "conv-b", keyB);
  expect(download).toHaveBeenCalledTimes(2);
  expect(secondUrl).not.toBe(firstUrl);
  releaseChatMediaCacheEntry(samePathA.path, firstUrl);
  releaseChatMediaCacheEntry(samePathB.path, secondUrl);
});

test("evicts idle entries while retaining active leases", async () => {
  const key = await createRoomKey();
  const { iv, ciphertext } = await encryptedFixture("conv-evict", key);
  const download = vi.fn().mockResolvedValue(new Uint8Array(ciphertext));
  (globalThis as unknown as { window: { hushWindow: unknown } }).window = { hushWindow: { downloadGDriveMedia: download } };
  const revokeUrl = vi.spyOn(URL, "revokeObjectURL");
  const active = fixtureAttachment("path-0", iv);
  const activeUrl = await downloadAndDecryptChatImage(active, "conv-evict", key);
  for (let i = 1; i <= 24; i += 1) {
    const attachment = fixtureAttachment(`path-${i}`, iv);
    const url = await downloadAndDecryptChatImage(attachment, "conv-evict", key);
    releaseChatMediaCacheEntry(attachment.path, url);
  }
  expect(revokeUrl).toHaveBeenCalled();
  expect(revokeUrl).not.toHaveBeenCalledWith(activeUrl);
  releaseChatMediaCacheEntry(active.path, activeUrl);
  clearChatMediaCache();
  expect(revokeUrl).toHaveBeenCalledWith(activeUrl);
  revokeUrl.mockRestore();
});

test("clear invalidates an in-flight load and revokes its late URL", async () => {
  const key = await createRoomKey();
  const { iv, ciphertext } = await encryptedFixture("conv-clear", key);
  let resolveDownload!: (value: Uint8Array) => void;
  const download = vi.fn().mockReturnValue(new Promise<Uint8Array>((resolve) => { resolveDownload = resolve; }));
  (globalThis as unknown as { window: { hushWindow: unknown } }).window = { hushWindow: { downloadGDriveMedia: download } };
  const revokeUrl = vi.spyOn(URL, "revokeObjectURL");
  const attachment = fixtureAttachment("clear-path", iv);
  const pending = downloadAndDecryptChatImage(attachment, "conv-clear", key);
  clearChatMediaCache();
  resolveDownload(new Uint8Array(ciphertext));
  await expect(pending).rejects.toThrow("invalidata durante il caricamento");
  expect(revokeUrl).toHaveBeenCalledTimes(1);
  revokeUrl.mockRestore();
});

test("keeps all 25 mounted images alive beyond idle cache capacity", async () => {
  const key = await createRoomKey();
  const { iv, ciphertext } = await encryptedFixture("conv-live", key);
  const download = vi.fn().mockResolvedValue(new Uint8Array(ciphertext));
  (globalThis as unknown as { window: { hushWindow: unknown } }).window = { hushWindow: { downloadGDriveMedia: download } };
  const revoke = vi.spyOn(URL, "revokeObjectURL");
  try {
    const attachments = Array.from({ length: 25 }, (_, index) => fixtureAttachment(`live-${index}`, iv));
    const urls = await Promise.all(attachments.map(attachment => downloadAndDecryptChatImage(attachment, "conv-live", key)));
    expect(revoke).not.toHaveBeenCalled();
    releaseChatMediaCacheEntry(attachments[0].path, urls[0]);
    expect(revoke).toHaveBeenCalledWith(urls[0]);
    expect(revoke).toHaveBeenCalledTimes(1);
  } finally { revoke.mockRestore(); }
});
