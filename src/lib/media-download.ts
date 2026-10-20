import { downloadChunkedMedia, type TransferOptions } from "./chunked-media";
import { downloadAndDecryptChatImage, releaseChatMediaCacheEntry, type ChatAttachmentMeta } from "./chat-media";
import { Capacitor } from '@capacitor/core';

type DiskWriter = { write: (bytes: Uint8Array<ArrayBuffer>) => Promise<void>; close: () => Promise<void>; abort: () => Promise<void> };
type SavePickerWindow = Window & { showSaveFilePicker?: (options: { suggestedName: string }) => Promise<{ createWritable: () => Promise<DiskWriter> }> };

export async function saveChatAttachment(attachment: ChatAttachmentMeta, conversationId: string, key: CryptoKey, options: TransferOptions = {}) {
  if (attachment.encryption !== "chunked-v1") {
    const url = await downloadAndDecryptChatImage(attachment, conversationId, key);
    if (options.signal?.aborted) {releaseChatMediaCacheEntry(attachment.path, url); options.signal.throwIfAborted();}
    if (Capacitor.isNativePlatform()) {
      try { const { exportNativeBlob } = await import('./native-files'); await exportNativeBlob(await (await fetch(url)).blob(), attachment.name); options.onProgress?.(1); }
      finally { releaseChatMediaCacheEntry(attachment.path, url); }
      return;
    }
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = attachment.name; anchor.click();
    setTimeout(() => releaseChatMediaCacheEntry(attachment.path, url), 30_000);
    options.onProgress?.(1);
    return;
  }
  const desktop = window.hushWindow;
  let writer: DiskWriter | null = null;
  if (Capacitor.isNativePlatform()) {
    const { nativeFileWriter } = await import('./native-files');
    writer = await nativeFileWriter(attachment.name);
  } else if (desktop?.beginAttachmentSave && desktop.writeAttachmentSave && desktop.finishAttachmentSave && desktop.abortAttachmentSave) {
    const token = await desktop.beginAttachmentSave(attachment.name);
    if (!token) return;
    let index = 0;
    writer = {
      write: bytes => desktop.writeAttachmentSave!(token, index++, bytes),
      close: () => desktop.finishAttachmentSave!(token),
      abort: () => desktop.abortAttachmentSave!(token),
    };
  } else {
    const browser = window as SavePickerWindow;
    if (browser.showSaveFilePicker) {
      const handle = await browser.showSaveFilePicker({ suggestedName: attachment.name });
      writer = await handle.createWritable();
    }
  }
  if (writer) {
    try {
      await downloadChunkedMedia(attachment, conversationId, key, bytes => writer!.write(bytes), options);
      await writer.close();
    } catch (error) { await writer.abort().catch(() => undefined); throw error; }
    return;
  }
  // Browsers without disk streaming retain Blob parts until the save starts.
  const parts: Blob[] = [];
  await downloadChunkedMedia(attachment, conversationId, key, async bytes => { parts.push(new Blob([bytes])); }, options);
  const url = URL.createObjectURL(new Blob(parts, { type: attachment.type }));
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = attachment.name; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
