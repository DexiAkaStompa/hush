import { beforeEach, test, expect, vi } from "vitest";
const mocks = vi.hoisted(() => ({ upload: vi.fn(), download: vi.fn() }));
vi.mock("./supabase", () => ({ supabase: {
  storage: { from: () => ({ upload: mocks.upload, download: mocks.download }) },
} }));

import { createRoomKey, decryptBinary } from "./crypto";
import {
  validateChatImage,
  uploadEncryptedChatImage,
  downloadAndDecryptChatImage,
  CHAT_IMAGE_LIMIT,
} from "./chat-media";


beforeEach(() => {
  vi.resetAllMocks();
  mocks.upload.mockResolvedValue({ error: null });
});


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
