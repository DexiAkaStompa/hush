import { beforeEach, expect, test, vi } from "vitest";
const files = vi.hoisted(() => ({
  writeFile: vi.fn(),
  appendFile: vi.fn(),
  getUri: vi.fn(),
  rmdir: vi.fn(),
  readdir: vi.fn(),
  share: vi.fn(),
}));
vi.mock("@capacitor/filesystem", () => ({
  Directory: { Cache: "CACHE" },
  Filesystem: files,
}));
vi.mock("@capacitor/share", () => ({ Share: { share: files.share } }));
import {
  nativeFileWriter,
  exportFileName,
  cleanNativeExports,
} from "./native-files";
beforeEach(() => {
  vi.resetAllMocks();
  files.getUri.mockResolvedValue({ uri: "file:///private/export/file.bin" });
  files.rmdir.mockResolvedValue(undefined);
});
test("mobile export writes bounded binary blocks in order and shares only its private URI", async () => {
  const bytes = Uint8Array.from({ length: 512 * 1024 + 7 }, (_, i) => i % 256);
  const writer = await nativeFileWriter("../../file.bin");
  await writer.write(bytes);
  await writer.write(new Uint8Array([0, 255, 42]));
  await writer.close();
  const blocks = files.appendFile.mock.calls.map(([arg]) =>
    Buffer.from(arg.data, "base64"),
  );
  expect(blocks.every((block) => block.length <= 192 * 1024)).toBe(true);
  expect(Buffer.concat(blocks)).toEqual(
    Buffer.concat([Buffer.from(bytes), Buffer.from([0, 255, 42])]),
  );
  expect(files.share).toHaveBeenCalledWith(
    expect.objectContaining({ files: ["file:///private/export/file.bin"] }),
  );
  expect(exportFileName("../\\bad\u0000:name")).not.toMatch(/[\\/:\u0000]/);
});
test("abort removes only its temporary export, and cleanup preserves recent shared files", async () => {
  const writer = await nativeFileWriter("cancel.bin");
  await writer.abort();
  expect(files.rmdir).toHaveBeenCalledWith(
    expect.objectContaining({
      directory: "CACHE",
      path: expect.stringMatching(/^hush-exports\/[a-f0-9-]+$/),
    }),
  );
  files.rmdir.mockClear();
  files.readdir.mockResolvedValue({
    files: [
      { name: "old", type: "directory", mtime: Date.now() - 86400001 },
      { name: "recent", type: "directory", mtime: Date.now() },
    ],
  });
  await cleanNativeExports();
  expect(files.rmdir).toHaveBeenCalledTimes(1);
  expect(files.rmdir).toHaveBeenCalledWith({
    path: "hush-exports/old",
    directory: "CACHE",
    recursive: true,
  });
});
