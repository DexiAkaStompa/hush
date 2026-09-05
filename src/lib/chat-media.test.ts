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
});
