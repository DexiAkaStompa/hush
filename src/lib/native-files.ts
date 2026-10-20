import { Directory, Filesystem } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";

export function exportFileName(name: string) {
  return (
    name
      .replace(/[\u0000-\u001f<>:"/\\|?*]/g, "_")
      .replace(/^\.+/, "")
      .slice(0, 160) || "allegato"
  );
}

// Keep only one bridge-sized chunk in memory; large attachments never become one Blob.
export async function nativeFileWriter(name: string) {
  const path = `hush-exports/${crypto.randomUUID()}/${exportFileName(name)}`;
  await Filesystem.writeFile({
    path,
    directory: Directory.Cache,
    data: "",
    recursive: true,
  });
  return {
    async write(bytes: Uint8Array) {
      for (let offset = 0; offset < bytes.length; offset += 192 * 1024) {
        const chunk = bytes.subarray(offset, offset + 192 * 1024);
        let binary = "";
        for (let i = 0; i < chunk.length; i += 8192)
          binary += String.fromCharCode(...chunk.subarray(i, i + 8192));
        await Filesystem.appendFile({
          path,
          directory: Directory.Cache,
          data: btoa(binary),
        });
      }
    },
    async close() {
      const { uri } = await Filesystem.getUri({
        path,
        directory: Directory.Cache,
      });
      await Share.share({
        title: name,
        files: [uri],
        dialogTitle: "Salva o condividi allegato",
      });
    },
    async abort() {
      await Filesystem.rmdir({
        path: path.slice(0, path.lastIndexOf("/")),
        directory: Directory.Cache,
        recursive: true,
      });
    },
  };
}

export async function exportNativeBlob(blob: Blob, name: string) {
  const writer = await nativeFileWriter(name);
  try {
    for (let offset = 0; offset < blob.size; offset += 192 * 1024) {
      await writer.write(
        new Uint8Array(
          await blob.slice(offset, offset + 192 * 1024).arrayBuffer(),
        ),
      );
    }
    await writer.close();
  } catch (error) {
    await writer.abort().catch(() => undefined);
    throw error;
  }
}

export async function cleanNativeExports() {
  // Shared files stay available long enough for the receiving app to read them.
  const { files } = await Filesystem.readdir({
    path: "hush-exports",
    directory: Directory.Cache,
  }).catch(() => ({ files: [] }));
  for (const file of files) {
    if (
      file.type === "directory" &&
      Date.now() - file.mtime > 24 * 60 * 60 * 1000
    ) {
      await Filesystem.rmdir({
        path: `hush-exports/${file.name}`,
        directory: Directory.Cache,
        recursive: true,
      }).catch(() => undefined);
    }
  }
}
