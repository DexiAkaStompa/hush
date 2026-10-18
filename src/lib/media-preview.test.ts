import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  download: vi.fn(),
  chunked: vi.fn(),
  legacy: vi.fn(),
  release: vi.fn(),
}));
vi.mock("./shared-media", () => ({ downloadSharedMedia: mocks.download }));
vi.mock("./chunked-media", () => ({ downloadChunkedMedia: mocks.chunked }));
vi.mock("./chat-media", () => ({
  downloadAndDecryptChatImage: mocks.legacy,
  releaseChatMediaCacheEntry: mocks.release,
}));
import {
  loadMediaPreview,
  playableMedia,
  MAX_INLINE_MEDIA_BYTES,
} from "./media-preview";
import { createRoomKey, encryptBinary } from "./crypto";
import type { ChatAttachmentMeta } from "./chat-media";
const attachment: ChatAttachmentMeta = {
  id: "a",
  path: "gdrive-shared:file",
  storage: "gdrive-shared",
  iv: "",
  name: "Beat.WAV",
  type: "audio/x-wav",
  size: 4,
};
beforeEach(() => vi.resetAllMocks());
afterEach(() => vi.restoreAllMocks());
describe("inline encrypted media", () => {
  it("recognizes audio, video and generic MIME filenames without previewing HTML", () => {
    expect(playableMedia(attachment)).toEqual({
      kind: "audio",
      mime: "audio/wav",
    });
    expect(
      playableMedia({ name: "clip.mp4", type: 'video/mp4; codecs="avc1"' }),
    ).toEqual({ kind: "video", mime: "video/mp4" });
    expect(
      playableMedia({ name: "BEAT.WAV", type: "application/octet-stream" }),
    ).toEqual({ kind: "audio", mime: "audio/wav" });
    expect(playableMedia({ name: "clip.mp4", type: "text/html" })).toBeNull();
    expect(playableMedia({ name: "clip.mp4.html", type: "" })).toBeNull();
  });
  it("decrypts audio privately, sets the playable MIME and releases its object URL once", async () => {
    const key = await createRoomKey(),
      bytes = new Uint8Array([1, 2, 3, 4]),
      encrypted = await encryptBinary(
        bytes.buffer,
        key,
        "hush:attachment:room",
      );
    mocks.download.mockResolvedValue(encrypted.ciphertext);
    const create = vi
        .spyOn(URL, "createObjectURL")
        .mockReturnValue("blob:preview"),
      revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const result = await loadMediaPreview(
      { ...attachment, iv: encrypted.iv },
      "room",
      key,
    );
    const blob = create.mock.calls[0][0] as Blob;
    expect(blob.type).toBe("audio/wav");
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(bytes);
    result.dispose();
    result.dispose();
    expect(revoke).toHaveBeenCalledOnce();
  });
  it("supports chunked videos and forwards cancellation and progress", async () => {
    const key = await createRoomKey(),
      controller = new AbortController(),
      onProgress = vi.fn();
    mocks.chunked.mockImplementation(async (_a, _c, _k, write, options) => {
      await write(new Uint8Array([4, 5]));
      await write(new Uint8Array([6, 7]));
      options.onProgress(1);
    });
    const create = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:video");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const result = await loadMediaPreview(
      {
        ...attachment,
        name: "clip.mp4",
        type: "video/mp4",
        encryption: "chunked-v1",
      },
      "room",
      key,
      { signal: controller.signal, onProgress },
    );
    const blob = create.mock.calls[0][0] as Blob;
    expect(blob.type).toBe("video/mp4");
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(
      new Uint8Array([4, 5, 6, 7]),
    );
    expect(mocks.chunked.mock.calls[0][4].signal).toBe(controller.signal);
    expect(onProgress).toHaveBeenCalledWith(1);
    result.dispose();
  });
  it("rejects a wrong room key or incomplete data instead of exposing bytes", async () => {
    const key = await createRoomKey(),
      encrypted = await encryptBinary(
        new Uint8Array([1, 2, 3, 4]).buffer,
        key,
        "hush:attachment:room",
      );
    mocks.download.mockResolvedValue(encrypted.ciphertext);
    const create = vi.spyOn(URL, "createObjectURL");
    await expect(
      loadMediaPreview({ ...attachment, iv: encrypted.iv }, "other-room", key),
    ).rejects.toThrow();
    await expect(
      loadMediaPreview(
        { ...attachment, iv: encrypted.iv, size: 8 },
        "room",
        key,
      ),
    ).rejects.toThrow("incompleto");
    expect(create).not.toHaveBeenCalled();
  });
  it("does not transfer files above the inline memory budget or cancelled requests", async () => {
    const key = await createRoomKey(),
      controller = new AbortController();
    controller.abort();
    await expect(
      loadMediaPreview(attachment, "room", key, { signal: controller.signal }),
    ).rejects.toThrow();
    await expect(
      loadMediaPreview(
        { ...attachment, size: MAX_INLINE_MEDIA_BYTES + 1 },
        "room",
        key,
      ),
    ).rejects.toThrow("troppo grande");
    expect(mocks.download).not.toHaveBeenCalled();
    expect(mocks.chunked).not.toHaveBeenCalled();
  });
});
