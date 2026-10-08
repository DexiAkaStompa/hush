import { beforeEach, expect, test, vi } from "vitest";
import { createRoomKey } from "./crypto";
const storage = vi.hoisted(() => ({parts: new Map<number | undefined, ArrayBuffer>(), upload: vi.fn(), download: vi.fn()}));
vi.mock("./shared-media", () => ({
  uploadSharedMedia: storage.upload,
  downloadSharedMedia: storage.download,
}));
import { uploadChunkedMedia, downloadChunkedMedia, MEDIA_CHUNK_BYTES } from "./chunked-media";

beforeEach(() => {
  storage.parts.clear(); vi.resetAllMocks();
  storage.upload.mockImplementation(async (_conv, _id, bytes, index) => {storage.parts.set(index, bytes); return "manifest-file-id";});
  storage.download.mockImplementation(async (_conv, _file, index) => storage.parts.get(index));
});

test("a file above 16 MB roundtrips in bounded authenticated chunks without reading the whole file", async () => {
  const bytes = new Uint8Array(MEDIA_CHUNK_BYTES * 2 + 100).fill(7); bytes[MEDIA_CHUNK_BYTES] = 11;
  const file = new File([bytes], "large.zip");
  const wholeFileRead = vi.spyOn(file, "arrayBuffer");
  const key = await createRoomKey(); const progress = vi.fn();
  const manifest = await uploadChunkedMedia(file, "conversation", "attachment", key, {onProgress: progress});
  expect(wholeFileRead).not.toHaveBeenCalled();
  expect(storage.upload).toHaveBeenCalledTimes(4);
  for (const [index, encrypted] of storage.parts) if (index !== undefined) expect(encrypted.byteLength).toBeLessThanOrEqual(MEDIA_CHUNK_BYTES + 28);
  expect(storage.upload.mock.calls.at(-1)?.[3]).toBeUndefined();
  expect(progress).toHaveBeenLastCalledWith(1);
  const output: Uint8Array[] = [];
  await downloadChunkedMedia({id:"attachment", size:file.size, iv:manifest.iv, path:"gdrive-shared:manifest-file-id"}, "conversation", key, async bytes => {output.push(bytes);});
  expect(output).toHaveLength(3);
  const actual = await crypto.subtle.digest("SHA-256", await new Blob(output as BlobPart[]).arrayBuffer());
  const expected = await crypto.subtle.digest("SHA-256", bytes);
  expect(new Uint8Array(actual)).toEqual(new Uint8Array(expected));
});

test("modified chunks fail authentication before reaching the disk writer", async () => {
  const file = new File([new Uint8Array(100)], "test"); const key = await createRoomKey();
  const manifest = await uploadChunkedMedia(file, "conversation", "attachment", key);
  new Uint8Array(storage.parts.get(0)!)[20] ^= 1;
  const write = vi.fn();
  await expect(downloadChunkedMedia({id:"attachment", size:file.size, iv:manifest.iv, path:"gdrive-shared:manifest-file-id"}, "conversation", key, write)).rejects.toThrow();
  expect(write).not.toHaveBeenCalled();
});

test("cancelled uploads never publish a manifest", async () => {
  const controller = new AbortController(); controller.abort();
  await expect(uploadChunkedMedia(new File([new Uint8Array(100)], "test"), "conversation", "attachment", await createRoomKey(), {signal:controller.signal})).rejects.toThrow();
  expect(storage.upload).not.toHaveBeenCalled();
});

test("chunk reordering and manifest size mismatches are rejected", async () => {
  const file = new File([new Uint8Array(MEDIA_CHUNK_BYTES + 1)], "test");const key = await createRoomKey();
  const manifest = await uploadChunkedMedia(file, "conversation", "attachment", key);
  const attachment = {id:"attachment", size:file.size, iv:manifest.iv, path:"gdrive-shared:manifest-file-id"};
  await expect(downloadChunkedMedia({...attachment,size:file.size+1}, "conversation", key, vi.fn())).rejects.toThrow("non valido");
  storage.parts.set(0, storage.parts.get(1)!);
  await expect(downloadChunkedMedia(attachment, "conversation", key, vi.fn())).rejects.toThrow("incompleto");
});
